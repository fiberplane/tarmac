export type WorkerComment = {
  readonly author?: string;
  readonly body: string;
  readonly createdAt?: string;
};

export type WorkerIssueContext = {
  readonly id: string;
  readonly displayId?: string;
  readonly title: string;
  readonly description?: string;
  readonly comments?: readonly WorkerComment[];
};

export type WorkerRepositoryContext = {
  readonly remoteUrl: string;
  readonly baseBranch: string;
  readonly baseSha: string;
};

export type PromptSecret = {
  readonly name: string;
  readonly value?: string;
};

export type PromptRedactionConfig = {
  readonly secrets?: readonly PromptSecret[];
  readonly forbiddenTerms?: readonly string[];
};

export type WorkerPromptInput = {
  readonly issue: WorkerIssueContext;
  readonly repository: WorkerRepositoryContext;
  readonly redaction?: PromptRedactionConfig;
};
