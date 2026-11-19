import { AIJobRunner } from "./ai-jobs";

export type WorkflowJobKind =
  | "vision"
  | "source_suggest"
  | "knowledge_compare"
  | "paper_split";

export function WorkflowJob({
  kind,
  target,
  onAdopt,
  adoptLabel,
}: {
  kind: WorkflowJobKind;
  target: Record<string, unknown>;
  onAdopt: (output: Record<string, unknown>, id: string) => void;
  adoptLabel?: string;
}) {
  return (
    <AIJobRunner
      kind={kind}
      target={target}
      onAdopt={onAdopt}
      adoptLabel={adoptLabel}
      showPreview={false}
    />
  );
}
