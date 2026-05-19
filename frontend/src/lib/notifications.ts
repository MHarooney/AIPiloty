import { toast } from "sonner";

export function notifySuccess(message: string) {
  toast.success(message);
}

export function notifyError(message: string) {
  toast.error(message);
}

export function notifyInfo(message: string) {
  toast.info(message);
}

export function notifyToolStart(toolName: string) {
  toast.info(`Running ${toolName.replace(/_/g, " ")}…`, { duration: 3000 });
}

export function notifyToolDone(toolName: string) {
  toast.success(`${toolName.replace(/_/g, " ")} completed`);
}

export function notifyToolError(toolName: string, error: string) {
  toast.error(`${toolName.replace(/_/g, " ")} failed: ${error}`, { duration: 5000 });
}
