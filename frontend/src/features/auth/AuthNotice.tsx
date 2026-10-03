import { Alert, AlertDescription } from "@/components/ui/alert";
export function AuthNotice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <Alert
      role={error ? "alert" : "status"}
      variant={error ? "destructive" : "default"}
    >
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
