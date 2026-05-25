import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { PurchaseOrderEmail } from "@carbon/documents/email";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { NotificationEvent } from "@carbon/notifications";
import { renderAsync } from "@react-email/components";
import { parseAcceptLanguage } from "intl-parse-accept-language";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getPaymentTermsList } from "~/modules/accounting";
import { upsertDocument } from "~/modules/documents";
import {
  finalizePurchaseOrder,
  getPurchaseOrder,
  getPurchaseOrderLines,
  getPurchaseOrderLocations,
  getResolvedPoAttachments,
  getSupplier,
  getSupplierContact,
  PO_ATTACHMENT_TOTAL_LIMIT_KB,
  purchaseOrderFinalizeValidator,
  updatePurchaseOrderStatus
} from "~/modules/purchasing";
import { getCompany, getCompanySettings } from "~/modules/settings";
import {
  createApprovalRequest,
  getApprovalRuleByAmount,
  getApproverUserIdsForRule,
  hasPendingApproval,
  isApprovalRequired
} from "~/modules/shared";
import { getUser } from "~/modules/users/users.server";
import { loader as pdfLoader } from "~/routes/file+/purchase-order+/$orderId[.]pdf";
import { path, requestReferrer } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

export async function action(args: ActionFunctionArgs) {
  const { request, params } = args;
  assertIsPost(request);

  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing",
    role: "employee"
  });

  const { orderId } = params;
  if (!orderId) throw new Error("Could not find orderId");

  let file: ArrayBuffer;
  let fileName: string;
  let documentFilePath: string;

  const serviceRole = getCarbonServiceRole();

  const purchaseOrder = await getPurchaseOrder(serviceRole, orderId);
  if (purchaseOrder.error) {
    throw redirect(
      path.to.purchaseOrder(orderId),
      await flash(
        request,
        error(purchaseOrder.error, "Failed to get purchase order")
      )
    );
  }

  if (purchaseOrder.data.companyId !== companyId) {
    throw redirect(
      path.to.purchaseOrders,
      await flash(
        request,
        error("You are not authorized to finalize this purchase order")
      )
    );
  }

  // Check supplier approval status
  const supplierApprovalRequired = await isApprovalRequired(
    serviceRole,
    "supplier",
    companyId
  );
  if (supplierApprovalRequired && purchaseOrder.data.supplierId) {
    const supplier = await getSupplier(
      serviceRole,
      purchaseOrder.data.supplierId
    );
    if (supplier.data?.status !== "Active") {
      throw redirect(
        path.to.purchaseOrder(orderId),
        await flash(
          request,
          error("Cannot finalize: supplier is not approved (Active)")
        )
      );
    }
  }

  const orderAmount = purchaseOrder.data.orderTotal ?? 0;
  const approvalRequired = await isApprovalRequired(
    serviceRole,
    "purchaseOrder",
    companyId,
    orderAmount
  );

  const finalize = await finalizePurchaseOrder(client, orderId, userId);
  if (finalize.error) {
    throw redirect(
      path.to.purchaseOrder(orderId),
      await flash(
        request,
        error(finalize.error, "Failed to finalize purchase order")
      )
    );
  }

  // If approval is required, create the request and return early
  // PDF generation, email sending, and price updates happen after approval
  if (approvalRequired) {
    const hasPending = await hasPendingApproval(
      serviceRole,
      "purchaseOrder",
      orderId
    );

    if (!hasPending) {
      await createApprovalRequest(serviceRole, {
        documentType: "purchaseOrder",
        documentId: orderId,
        companyId,
        requestedBy: userId,
        createdBy: userId,
        amount: orderAmount
      });

      const rule = await getApprovalRuleByAmount(
        serviceRole,
        "purchaseOrder",
        companyId,
        orderAmount
      );
      const approverIds = rule.data
        ? await getApproverUserIdsForRule(serviceRole, rule.data)
        : [];

      if (approverIds.length > 0) {
        try {
          await trigger("notify", {
            event: NotificationEvent.ApprovalRequested,
            companyId,
            documentId: orderId,
            documentType: "purchaseOrder",
            recipient: { type: "users", userIds: approverIds },
            from: userId
          });
        } catch (e) {
          console.error("Failed to trigger approval notification", e);
        }
      }
    }

    await updatePurchaseOrderStatus(client, {
      id: orderId,
      status: "Needs Approval",
      assignee: undefined,
      updatedBy: userId
    });

    throw redirect(
      requestReferrer(request) ?? path.to.purchaseOrder(orderId),
      await flash(request, success("Purchase order submitted for approval"))
    );
  }

  // Check if we should update prices on purchase order finalize
  const companySettings = await getCompanySettings(serviceRole, companyId);
  if (
    companySettings.data?.purchasePriceUpdateTiming ===
    "Purchase Order Finalize"
  ) {
    const priceUpdate = await serviceRole.functions.invoke(
      "update-purchased-prices",
      {
        body: {
          purchaseOrderId: orderId,
          companyId,
          source: "purchaseOrder",
          updatePrices: true,
          updateLeadTimes: false
        }
      }
    );

    if (priceUpdate.error) {
      console.error("Failed to update purchased prices:", priceUpdate.error);
      // Don't fail the entire finalization, just log the error
    }
  }

  const acceptLanguage = request.headers.get("accept-language");
  const locales = parseAcceptLanguage(acceptLanguage, {
    validate: Intl.DateTimeFormat.supportedLocalesOf
  });

  try {
    const pdf = await pdfLoader(args);
    if (pdf.headers.get("content-type") !== "application/pdf")
      throw new Error("Failed to generate PDF");

    file = await pdf.arrayBuffer();
    fileName = stripSpecialCharacters(
      `${purchaseOrder.data.purchaseOrderId} - ${new Date()
        .toISOString()
        .slice(0, -5)}.pdf`
    );

    documentFilePath = `${companyId}/supplier-interaction/${purchaseOrder.data.supplierInteractionId}/${fileName}`;

    const documentFileUpload = await serviceRole.storage
      .from("private")
      .upload(documentFilePath, file, {
        cacheControl: `${12 * 60 * 60}`,
        contentType: "application/pdf",
        upsert: true
      });

    if (documentFileUpload.error) {
      throw redirect(
        path.to.purchaseOrder(orderId),
        await flash(
          request,
          error(documentFileUpload.error, "Failed to upload file")
        )
      );
    }

    const createDocument = await upsertDocument(serviceRole, {
      path: documentFilePath,
      name: fileName,
      size: Math.round(file.byteLength / 1024),
      sourceDocument: "Purchase Order",
      sourceDocumentId: orderId,
      readGroups: [userId],
      writeGroups: [userId],
      createdBy: userId,
      companyId
    });

    if (createDocument.error) {
      return redirect(
        path.to.purchaseOrder(orderId),
        await flash(
          request,
          error(createDocument.error, "Failed to create document")
        )
      );
    }
  } catch (err) {
    throw redirect(
      path.to.purchaseOrder(orderId),
      await flash(request, error(err, "Failed to generate PDF"))
    );
  }

  const validation = await validator(purchaseOrderFinalizeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { notification, supplierContact, cc: ccSelections } = validation.data;

  const logPrefix = `[finalize PO ${orderId}]`;

  switch (notification) {
    case "Email":
      console.log(`${logPrefix} email branch entered`, {
        supplierContact,
        ccCount: ccSelections?.length ?? 0
      });
      try {
        if (!supplierContact) throw new Error("Supplier contact is required");

        const [
          company,
          supplier,
          purchaseOrder,
          purchaseOrderLines,
          purchaseOrderLocations,
          paymentTerms,
          buyer
        ] = await Promise.all([
          getCompany(serviceRole, companyId),
          getSupplierContact(serviceRole, supplierContact),
          getPurchaseOrder(serviceRole, orderId),
          getPurchaseOrderLines(serviceRole, orderId),
          getPurchaseOrderLocations(serviceRole, orderId),
          getPaymentTermsList(serviceRole, companyId),
          getUser(serviceRole, userId)
        ]);

        if (!supplier?.data?.contact) {
          console.error(`${logPrefix} supplier contact lookup failed`, {
            supplierContactId: supplierContact,
            supplierResult: supplier
          });
          throw new Error("Failed to get supplier contact");
        }
        if (!company.data) throw new Error("Failed to get company");
        if (!buyer.data) throw new Error("Failed to get user");
        if (!purchaseOrder.data)
          throw new Error("Failed to get purchase order");
        if (!purchaseOrderLocations.data)
          throw new Error("Failed to get purchase order locations");
        if (!paymentTerms.data) throw new Error("Failed to get payment terms");

        if (!supplier.data.contact.email) {
          console.warn(
            `${logPrefix} supplier contact has no email — skipping send`,
            { supplierContactId: supplierContact }
          );
        }
        if (supplier.data.contact.email) {
          const emailTemplate = PurchaseOrderEmail({
            // @ts-expect-error TS2739 - TODO: fix type
            company: company.data,
            locale: locales?.[0] ?? "en-US",
            purchaseOrder: purchaseOrder.data,
            purchaseOrderLines: purchaseOrderLines.data ?? [],
            purchaseOrderLocations: purchaseOrderLocations.data,
            recipient: {
              email: supplier.data.contact.email,
              firstName: supplier.data.contact.firstName ?? undefined,
              lastName: supplier.data.contact.lastName ?? undefined
            },
            sender: {
              email: buyer.data.email,
              firstName: buyer.data.firstName,
              lastName: buyer.data.lastName
            },
            paymentTerms: paymentTerms.data
          });

          const html = await renderAsync(emailTemplate);
          const text = await renderAsync(emailTemplate, { plainText: true });

          // Resolve cascaded attachments (Company + Supplier + Item + PO ad-hoc).
          // The freshly-uploaded PO PDF is in supplier-interaction/ and rides
          // along naturally as a `po`-source file in the cascade.
          const itemIds = Array.from(
            new Set(
              (purchaseOrderLines.data ?? [])
                .map((l) => l.itemId)
                .filter((id): id is string => !!id)
            )
          );
          const resolved = await getResolvedPoAttachments(serviceRole, {
            companyId,
            supplierId: purchaseOrder.data.supplierId ?? null,
            supplierInteractionId:
              purchaseOrder.data.supplierInteractionId ?? null,
            itemIds
          });
          console.log(`${logPrefix} resolved cascaded attachments`, {
            total: resolved.length,
            bySource: resolved.reduce<Record<string, number>>((acc, r) => {
              acc[r.source] = (acc[r.source] ?? 0) + 1;
              return acc;
            }, {})
          });

          // Enforce 25 MB total cap (PO PDF + cascaded attachments).
          const poPdfSizeKb = Math.round(file.byteLength / 1024);
          const cascadedSizeKb = resolved.reduce(
            (sum, r) => sum + (r.size ?? 0),
            0
          );
          console.log(`${logPrefix} size budget`, {
            poPdfSizeKb,
            cascadedSizeKb,
            totalKb: poPdfSizeKb + cascadedSizeKb,
            limitKb: PO_ATTACHMENT_TOTAL_LIMIT_KB
          });
          if (poPdfSizeKb + cascadedSizeKb > PO_ATTACHMENT_TOTAL_LIMIT_KB) {
            throw new Error(
              `Total attachments exceed ${PO_ATTACHMENT_TOTAL_LIMIT_KB / 1024} MB limit`
            );
          }

          // Sign every cascaded attachment for the email job.
          const cascadedAttachments = (
            await Promise.all(
              resolved.map(async (r) => {
                const { data, error: signErr } = await serviceRole.storage
                  .from("private")
                  .createSignedUrl(r.path, 3600);
                if (signErr || !data?.signedUrl) {
                  console.error(
                    `${logPrefix} failed to sign cascaded attachment`,
                    {
                      source: r.source,
                      name: r.name,
                      path: r.path,
                      error: signErr
                    }
                  );
                  return null;
                }
                return { path: data.signedUrl, filename: r.name };
              })
            )
          ).filter((a): a is { path: string; filename: string } => a !== null);
          console.log(`${logPrefix} signed cascaded attachments`, {
            requested: resolved.length,
            successful: cascadedAttachments.length
          });

          const allAttachments = cascadedAttachments;

          const triggerPayload = {
            to: [buyer.data.email, supplier.data.contact.email],
            cc: ccSelections?.length ? ccSelections : undefined,
            from: buyer.data.email,
            subject: `Purchase Order ${purchaseOrder.data.purchaseOrderId} from ${company.data.name}`,
            html,
            text,
            attachments: allAttachments.length ? allAttachments : undefined,
            companyId
          };

          console.log(`${logPrefix} dispatching send-email`, {
            to: triggerPayload.to,
            cc: triggerPayload.cc,
            from: triggerPayload.from,
            subject: triggerPayload.subject,
            attachmentCount: allAttachments.length,
            attachmentNames: allAttachments.map((a) => a.filename),
            htmlLength: html.length,
            textLength: text.length
          });

          try {
            const triggerResult = await trigger("send-email", triggerPayload);
            console.log(`${logPrefix} send-email dispatched`, {
              result: triggerResult
            });
          } catch (triggerErr) {
            console.error(`${logPrefix} trigger("send-email") threw`, {
              name: (triggerErr as Error)?.name,
              message: (triggerErr as Error)?.message,
              stack: (triggerErr as Error)?.stack
            });
            throw triggerErr;
          }
        }
      } catch (err) {
        console.error(`${logPrefix} email send failed`, {
          name: (err as Error)?.name,
          message: (err as Error)?.message,
          stack: (err as Error)?.stack,
          raw: err
        });
        throw redirect(
          path.to.purchaseOrder(orderId),
          await flash(request, error(err, "Failed to send email"))
        );
      }

      break;
    case undefined:
    case "None":
      break;
    default:
      throw new Error("Invalid notification type");
  }

  throw redirect(
    requestReferrer(request) ?? path.to.purchaseOrder(orderId),
    await flash(request, success("Purchase order finalized"))
  );
}
