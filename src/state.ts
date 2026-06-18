import { Annotation } from "@langchain/langgraph";

export const GraphState = Annotation.Root({
  issueNumber: Annotation<number>({ reducer: (x, y) => y ?? x, default: () => 0 }),
  userStoryId: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
  userStoryBody: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
  boundedContext: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
  epicContext: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
  frontStatus: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "pending" }),
  backStatus: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "pending" }),
  qaStatus: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "pending" }),
  overallStatus: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "in_progress" }),
  needsArchitect: Annotation<boolean>({ reducer: (x, y) => y ?? x, default: () => false }),
  needsFront: Annotation<boolean>({ reducer: (x, y) => y ?? x, default: () => true }),
  needsBack: Annotation<boolean>({ reducer: (x, y) => y ?? x, default: () => true }),
  qaFeedback: Annotation<string[]>({ reducer: (x, y) => x.concat(y), default: () => [] }),
  leadtechFeedback: Annotation<string[]>({ reducer: (x, y) => x.concat(y), default: () => [] }),
  humanFeedback: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
  testResults: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
  messages: Annotation<any[]>({ reducer: (x, y) => x.concat(y), default: () => [] }),
});
