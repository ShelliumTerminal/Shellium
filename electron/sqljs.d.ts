declare module "sql.js/dist/sql-asm.js" {
  type SqlJsStatic = {
    Database: new (data?: Uint8Array) => SqlJsDatabase;
  };

  type SqlJsDatabase = {
    run(sql: string, params?: unknown[]): SqlJsDatabase;
    exec(sql: string, params?: unknown[]): Array<{ columns: string[]; values: unknown[][] }>;
    prepare(sql: string): SqlJsStatement;
    export(): Uint8Array;
    close(): void;
  };

  type SqlJsStatement = {
    run(params?: unknown[]): void;
    free(): void;
  };

  export default function initSqlJs(config?: Record<string, unknown>): Promise<SqlJsStatic>;
}