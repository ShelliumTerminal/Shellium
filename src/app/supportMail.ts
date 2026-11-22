import { askConfirm } from "./confirmDialog";

/** Where bug reports and feedback go (the main process builds the mail with the same address). */
export const SUPPORT_ADDRESS = "support@shellium.app";

/** Help > Report a Bug / Send Feedback: opens a new mail; without a mail app, offers to copy the address. */
export async function openSupportMail(kind: "bug" | "feedback") {
  const opened = await window.shellium?.app.sendFeedback(kind).catch(() => false);
  if (opened) return;
  const copy = await askConfirm({
    title: "No mail app found",
    body: `Shellium could not open a new mail. Write to ${SUPPORT_ADDRESS} from your mail app or web mail, and include the version from Help › About.`,
    confirmLabel: "Copy address",
  });
  if (copy) await window.shellium?.clipboard.writeText(SUPPORT_ADDRESS);
}
