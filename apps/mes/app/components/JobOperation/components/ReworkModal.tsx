import type { Result } from "@carbon/auth";
import {
  Hidden,
  NumberControlled,
  Select,
  TextArea,
  ValidatedForm
} from "@carbon/form";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { triggerReworkValidator } from "~/services/models";
import type { OperationWithDetails } from "~/services/types";
import { path } from "~/utils/path";

type UpstreamOperation = {
  id: string;
  processId: string;
  description: string | null;
  order: number;
  status: string;
};

export function ReworkModal({
  operation,
  jobId,
  isOpen,
  onClose
}: {
  operation: OperationWithDetails;
  jobId: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<Result>();
  const targetsFetcher = useFetcher<{
    operations: UpstreamOperation[];
  }>();
  const [quantity, setQuantity] = useState(1);

  const targets = targetsFetcher.data?.operations ?? [];

  useEffect(() => {
    if (isOpen) {
      targetsFetcher.load(path.to.reworkTargets(operation.id));
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: ignore
  }, [isOpen]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      toast.success(t`Rework created successfully`);
      onClose();
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: ignore
  }, [fetcher.state, fetcher.data]);

  if (!isOpen) return null;

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.triggerRework}
          validator={triggerReworkValidator}
          defaultValues={{
            jobId,
            triggeredAtJobOperationId: operation.id,
            targetJobOperationId: "",
            reason: "",
            quantity: 1
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Create Rework</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Select the operation to go back to. All operations from that
                point to the current operation will be redone.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="jobId" value={jobId} />
            <Hidden name="triggeredAtJobOperationId" value={operation.id} />
            <VStack spacing={4}>
              <Select
                name="targetJobOperationId"
                label={t`Go back to operation`}
                size="lg"
                options={targets.map((op) => ({
                  value: op.id,
                  label: op.description || op.processId
                }))}
              />
              <NumberControlled
                name="quantity"
                label={t`Quantity`}
                value={quantity}
                onChange={setQuantity}
                minValue={1}
                size="lg"
              />
              <TextArea
                name="reason"
                label={t`Reason for rework`}
                placeholder={t`Describe what needs to be reworked...`}
                size="lg"
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button variant="secondary" size="lg" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                type="submit"
                size="lg"
                isDisabled={fetcher.state !== "idle"}
              >
                <Trans>Create Rework</Trans>
              </Button>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
