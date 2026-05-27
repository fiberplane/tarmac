import { Schema } from "effect";

export type JsonlReadResult<T> = {
  readonly entries: readonly T[];
  readonly corruptLineCount: number;
};

const decodeJsonLine = <A, I>(schema: Schema.Schema<A, I>, line: string): A =>
  Schema.decodeUnknownSync(schema)(JSON.parse(line));

export const appendJsonlLine = async (filePath: string, value: unknown): Promise<void> => {
  const file = Bun.file(filePath);
  const line = `${JSON.stringify(value)}\n`;
  if (await file.exists()) {
    const existing = await file.text();
    await Bun.write(filePath, `${existing}${line}`);
    return;
  }

  await Bun.write(filePath, line, {
    createPath: true,
  });
};

export const readJsonlFile = async <A, I>(
  filePath: string,
  schema: Schema.Schema<A, I>,
): Promise<JsonlReadResult<A>> => {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return {
      entries: [],
      corruptLineCount: 0,
    };
  }

  const raw = await file.text();
  if (raw.trim() === "") {
    return {
      entries: [],
      corruptLineCount: 0,
    };
  }

  const entries: A[] = [];
  let corruptLineCount = 0;
  const lines = raw.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || line.trim() === "") {
      continue;
    }

    try {
      entries.push(decodeJsonLine(schema, line));
    } catch {
      corruptLineCount += 1;
    }
  }

  return {
    entries,
    corruptLineCount,
  };
};
