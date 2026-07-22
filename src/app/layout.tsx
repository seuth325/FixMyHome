import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthSessionProvider } from "@/lib/session-provider";
import { ThemeProvider } from "@/lib/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { ReactQueryProvider } from "@/lib/query-client";
import { FixMyHomeChat } from "@/components/assistant/fixmyhome-chat";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "FixMyHome - Connect with Local Handymen",
  description: "Post your home repair job, get competitive bids from local handymen, and hire with confidence.",
  icons: {
    icon: "/icon.png",
    shortcut: "/favicon.ico",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`} suppressHydrationWarning>
        <AuthSessionProvider>
          <ThemeProvider>
            <ReactQueryProvider>
              {children}
              <FixMyHomeChat />
              <Toaster />
            </ReactQueryProvider>
          </ThemeProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
