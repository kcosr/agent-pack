export interface TableColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | undefined;
}

export function renderTable<T>(columns: TableColumn<T>[], rows: T[]): string {
  const renderedRows = rows.map((row) => columns.map((column) => String(column.value(row) ?? "")));
  const widths = columns.map((column, index) =>
    Math.max(column.header.length, ...renderedRows.map((row) => row[index]?.length ?? 0)),
  );
  const lastIndex = columns.length - 1;
  const header = columns
    .map((column, index) =>
      tableCell(column.header, widths[index] ?? column.header.length, index, lastIndex),
    )
    .join("  ");
  const body = renderedRows.map((row) =>
    row
      .map((value, index) => tableCell(value, widths[index] ?? value.length, index, lastIndex))
      .join("  "),
  );
  return `${[header, ...body].join("\n")}\n`;
}

function tableCell(value: string, width: number, index: number, lastIndex: number): string {
  return index === lastIndex ? value : value.padEnd(width);
}
