import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  ScrollArea,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { memo, useMemo } from "react";
import { LuPlus, LuTriangleAlert } from "react-icons/lu";
import { Link } from "react-router";
import { Empty } from "~/components";
import { useCurrencyFormatter, usePermissions } from "~/hooks";
import {
  type ApprovalRule,
  approvalDocumentTypesWithAmounts
} from "~/modules/shared";
import { topTierExplicitMax } from "~/modules/shared/approval-rules.coverage";
import { path } from "~/utils/path";
import ApprovalRuleCard from "./ApprovalRuleCard";

type ApprovalRulesProps = {
  poRules: ApprovalRule[];
  qdRules: ApprovalRule[];
  supplierRules: ApprovalRule[];
};

const ApprovalRules = memo(
  ({ poRules, qdRules, supplierRules }: ApprovalRulesProps) => {
    const permissions = usePermissions();
    const canCreate = permissions.can("update", "settings");
    const currencyFormatter = useCurrencyFormatter();
    const poTopTierGap = useMemo(
      () => topTierExplicitMax(poRules, "purchaseOrder"),
      [poRules]
    );

    return (
      <ScrollArea className="h-full w-full">
        <div className="py-12 px-4 max-w-[60rem] mx-auto">
          <div className="mb-8">
            <Heading size="h2">
              <Trans>Approval Rules</Trans>
            </Heading>
          </div>

          <VStack spacing={4}>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">
                      <Trans>Purchase Orders</Trans>
                    </CardTitle>
                    <CardDescription className="text-sm">
                      <Trans>
                        Require approval for purchase orders based on amount
                        thresholds
                      </Trans>
                    </CardDescription>
                  </div>
                  {canCreate && (
                    <Button variant="primary" leftIcon={<LuPlus />} asChild>
                      <Link to={path.to.newApprovalRule("purchaseOrder")}>
                        <Trans>New Rule</Trans>
                      </Link>
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {poTopTierGap != null && (
                  <Alert variant="warning" className="mb-4">
                    <LuTriangleAlert className="h-4 w-4" />
                    <AlertTitle>
                      <Trans>Highest-tier rule has a maximum</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      <Trans>
                        Purchase orders above{" "}
                        {currencyFormatter.format(poTopTierGap)} will not
                        require approval. Edit the top-tier rule and clear the
                        Maximum Amount, or add a higher rule with no maximum.
                      </Trans>
                    </AlertDescription>
                  </Alert>
                )}
                {poRules.length === 0 ? (
                  <Empty className="my-4" />
                ) : (
                  <VStack spacing={3} className="items-stretch">
                    {poRules
                      .filter((r) => r.id)
                      .map((rule) => (
                        <ApprovalRuleCard
                          key={rule.id}
                          rule={rule}
                          documentType="purchaseOrder"
                        />
                      ))}
                  </VStack>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">
                      <Trans>Quality Documents</Trans>
                    </CardTitle>
                    <CardDescription className="text-sm">
                      <Trans>
                        Require approval for quality documents in your workflow
                      </Trans>
                    </CardDescription>
                  </div>
                  {canCreate &&
                    (approvalDocumentTypesWithAmounts.includes(
                      "qualityDocument"
                    ) ||
                      qdRules.length === 0) && (
                      <Button variant="primary" leftIcon={<LuPlus />} asChild>
                        <Link to={path.to.newApprovalRule("qualityDocument")}>
                          <Trans>New Rule</Trans>
                        </Link>
                      </Button>
                    )}
                </div>
              </CardHeader>
              <CardContent>
                {qdRules.length === 0 ? (
                  <Empty className="my-4" />
                ) : (
                  <VStack spacing={3} className="items-stretch">
                    {qdRules
                      .filter((r) => r.id)
                      .map((rule) => (
                        <ApprovalRuleCard
                          key={rule.id}
                          rule={rule}
                          documentType="qualityDocument"
                        />
                      ))}
                  </VStack>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">
                      <Trans>Suppliers</Trans>
                    </CardTitle>
                    <CardDescription className="text-sm">
                      <Trans>
                        Require approval before suppliers can be set to Active
                      </Trans>
                    </CardDescription>
                  </div>
                  {canCreate && supplierRules.length === 0 && (
                    <Button variant="primary" leftIcon={<LuPlus />} asChild>
                      <Link to={path.to.newApprovalRule("supplier")}>
                        <Trans>New Rule</Trans>
                      </Link>
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {supplierRules.length === 0 ? (
                  <Empty className="my-4" />
                ) : (
                  <VStack spacing={3} className="items-stretch">
                    {supplierRules
                      .filter((r) => r.id)
                      .map((rule) => (
                        <ApprovalRuleCard
                          key={rule.id}
                          rule={rule}
                          documentType="supplier"
                        />
                      ))}
                  </VStack>
                )}
              </CardContent>
            </Card>
          </VStack>
        </div>
      </ScrollArea>
    );
  }
);

ApprovalRules.displayName = "ApprovalRules";
export default ApprovalRules;
