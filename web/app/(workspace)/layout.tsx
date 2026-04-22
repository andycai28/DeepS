import { UnifiedChatProvider } from "@/context/UnifiedChatContext";

/**
 * Outer workspace layout. Hosts the shared chat context and the flex
 * container; the sidebar lives in each child segment's layout so the
 * two sidebars (main nav vs outline tree) mount independently and
 * don't unmount/remount when the user moves between them.
 */
export default function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <UnifiedChatProvider>
      <div className="flex h-screen overflow-hidden">{children}</div>
    </UnifiedChatProvider>
  );
}
