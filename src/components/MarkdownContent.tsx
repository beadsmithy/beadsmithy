import type {
  AnchorHTMLAttributes,
  ComponentPropsWithoutRef,
  ReactNode,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ExternalLinkOpener } from "./external-link-opener";
import { openExternalLink as defaultOpenExternalLink } from "./external-link-opener";

const isExternalHttpLink = (href: string | undefined): href is string => {
  if (href === undefined) {
    return false;
  }
  return href.startsWith("http://") || href.startsWith("https://");
};

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children?: ReactNode;
};

type ParagraphProps = ComponentPropsWithoutRef<"p">;
type ListProps = ComponentPropsWithoutRef<"ul">;
type OrderedListProps = ComponentPropsWithoutRef<"ol">;
type ListItemProps = ComponentPropsWithoutRef<"li">;
type BlockquoteProps = ComponentPropsWithoutRef<"blockquote">;
type InlineCodeProps = ComponentPropsWithoutRef<"code">;
type PreProps = ComponentPropsWithoutRef<"pre">;
type TableProps = ComponentPropsWithoutRef<"table">;
type TableRowProps = ComponentPropsWithoutRef<"tr">;
type TableCellProps = ComponentPropsWithoutRef<"td">;
type TableHeaderProps = ComponentPropsWithoutRef<"th">;
type InputProps = ComponentPropsWithoutRef<"input"> & {
  node?: unknown;
};

const PARAGRAPH_CLASSES =
  "text-sm leading-6 text-text-main [&:not(:first-child)]:mt-3";
const HEADING_CLASSES = "font-semibold text-primary [&:not(:first-child)]:mt-5";
const H1_CLASSES = `${HEADING_CLASSES} text-xl`;
const H2_CLASSES = `${HEADING_CLASSES} text-lg`;
const H3_CLASSES = `${HEADING_CLASSES} text-base`;
const H4_CLASSES = `${HEADING_CLASSES} text-sm`;
const LIST_CLASSES = "list-inside text-sm leading-6 text-text-main";
const ORDERED_LIST_CLASSES = `${LIST_CLASSES} list-decimal`;
const UNORDERED_LIST_CLASSES = `${LIST_CLASSES} list-disc`;
const LIST_ITEM_CLASSES = "[&>p]:inline";
const BLOCKQUOTE_CLASSES =
  "mt-3 border-l-2 border-border-main pl-3 text-sm italic text-muted";
const INLINE_CODE_CLASSES =
  "rounded bg-surface px-1 py-0.5 font-mono text-[0.85em] text-text-main";
const CODE_BLOCK_CLASSES =
  "mt-3 overflow-x-auto rounded-md border border-border-main bg-surface p-3 font-mono text-xs text-text-main [&>code]:bg-transparent [&>code]:p-0";
const TABLE_CLASSES =
  "mt-3 w-full border-collapse text-sm text-text-main [&_th]:border [&_th]:border-border-main [&_th]:bg-surface [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-mono [&_th]:text-[10px] [&_th]:tracking-wider [&_th]:text-muted [&_th]:uppercase [&_td]:border [&_td]:border-border-main [&_td]:px-2 [&_td]:py-1";
const EXTERNAL_LINK_CLASSES =
  "text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent";
const CHECKBOX_CLASSES =
  "size-4 shrink-0 align-middle rounded-sm border border-border-main bg-surface accent-accent cursor-default disabled:opacity-100";

const renderParagraph = ({ children, ...rest }: ParagraphProps) => (
  <p className={PARAGRAPH_CLASSES} {...rest}>
    {children}
  </p>
);

const renderHeading = (Tag: "h1" | "h2" | "h3" | "h4", className: string) => {
  const Component = ({
    children,
    ...rest
  }: ComponentPropsWithoutRef<"h1">): React.ReactElement => (
    <Tag className={className} {...rest}>
      {children}
    </Tag>
  );
  Component.displayName = `Markdown${Tag.toUpperCase()}`;
  return Component;
};

const MarkdownH1 = renderHeading("h1", H1_CLASSES);
const MarkdownH2 = renderHeading("h2", H2_CLASSES);
const MarkdownH3 = renderHeading("h3", H3_CLASSES);
const MarkdownH4 = renderHeading("h4", H4_CLASSES);

const renderUnorderedList = ({ children, ...rest }: ListProps) => (
  <ul className={UNORDERED_LIST_CLASSES} {...rest}>
    {children}
  </ul>
);

const renderOrderedList = ({ children, ...rest }: OrderedListProps) => (
  <ol className={ORDERED_LIST_CLASSES} {...rest}>
    {children}
  </ol>
);

const renderListItem = ({ children, ...rest }: ListItemProps) => (
  <li className={LIST_ITEM_CLASSES} {...rest}>
    {children}
  </li>
);

const renderBlockquote = ({ children, ...rest }: BlockquoteProps) => (
  <blockquote className={BLOCKQUOTE_CLASSES} {...rest}>
    {children}
  </blockquote>
);

const renderInlineCode = ({ children, ...rest }: InlineCodeProps) => (
  <code className={INLINE_CODE_CLASSES} {...rest}>
    {children}
  </code>
);

const renderPre = ({ children, ...rest }: PreProps) => (
  <pre className={CODE_BLOCK_CLASSES} {...rest}>
    {children}
  </pre>
);

const renderTable = ({ children, ...rest }: TableProps) => (
  <table className={TABLE_CLASSES} {...rest}>
    {children}
  </table>
);

const renderTableRow = ({ children, ...rest }: TableRowProps) => (
  <tr {...rest}>{children}</tr>
);

const renderTableCell = ({ children, ...rest }: TableCellProps) => (
  <td {...rest}>{children}</td>
);

const renderTableHeader = ({ children, ...rest }: TableHeaderProps) => (
  <th scope="col" {...rest}>
    {children}
  </th>
);

const renderInput = ({
  className: _ignoredClassName,
  node: _ignoredNode,
  ...inputProps
}: InputProps): React.ReactElement => (
  // GFM task-list checkboxes are emitted by remark-gfm as
  // <input type="checkbox" checked disabled>. The Markdown pipeline only
  // invokes the `input` override for task-list checkboxes (see
  // mdast-util-gfm-task-list-item), so we always render a styled checkbox.
  <input className={CHECKBOX_CLASSES} type="checkbox" {...inputProps} />
);

const renderLink =
  (openExternalLink: ExternalLinkOpener) =>
  ({ children, href, ...rest }: LinkProps): React.ReactElement => {
    if (!isExternalHttpLink(href)) {
      return <span data-inert-link="true">{children}</span>;
    }

    const handleClick: NonNullable<LinkProps["onClick"]> = (event) => {
      event.preventDefault();
      openExternalLink(href);
    };

    return (
      <a
        className={EXTERNAL_LINK_CLASSES}
        href={href}
        onClick={handleClick}
        rel="noopener noreferrer"
        target="_blank"
        {...rest}
      >
        {children}
      </a>
    );
  };

interface MarkdownContentProps {
  markdown: string;
  openExternalLink?: ExternalLinkOpener;
  className?: string;
}

export const MarkdownContent = ({
  markdown,
  openExternalLink = defaultOpenExternalLink,
  className,
}: MarkdownContentProps) => {
  const componentOverrides = {
    a: renderLink(openExternalLink),
    blockquote: renderBlockquote,
    code: renderInlineCode,
    h1: MarkdownH1,
    h2: MarkdownH2,
    h3: MarkdownH3,
    h4: MarkdownH4,
    input: renderInput,
    li: renderListItem,
    ol: renderOrderedList,
    p: renderParagraph,
    pre: renderPre,
    table: renderTable,
    td: renderTableCell,
    th: renderTableHeader,
    tr: renderTableRow,
    ul: renderUnorderedList,
  } as const;

  const articleClassName =
    className === undefined || className.length === 0
      ? "text-text-main"
      : `text-text-main ${className}`;

  return (
    <article className={articleClassName}>
      <Markdown
        components={componentOverrides}
        remarkPlugins={[remarkGfm]}
        skipHtml
      >
        {markdown}
      </Markdown>
    </article>
  );
};
