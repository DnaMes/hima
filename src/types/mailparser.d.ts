declare module "mailparser" {
  export type MailAddress = {
    address?: string;
    name?: string;
  };

  export type AddressObject = {
    value?: MailAddress[];
  };

  export type ParsedMail = {
    date?: Date;
    from?: AddressObject;
    replyTo?: AddressObject;
    headers: Map<string, unknown>;
    to?: AddressObject | AddressObject[];
    subject?: string;
    messageId?: string;
    text?: string;
    html?: string | false;
    attachments: Array<unknown>;
  };

  export function simpleParser(
    source: Buffer,
    options?: { skipHtmlToText?: boolean },
  ): Promise<ParsedMail>;
}
