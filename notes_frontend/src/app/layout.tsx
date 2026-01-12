import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/toast/ToastProvider";

export const metadata: Metadata = {
  title: "Personal Notes Manager",
  description: "Create, edit, and organize your personal notes.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning className="ocean-gradient min-h-screen">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
