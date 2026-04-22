import WorkspaceSidebar from "@/components/sidebar/WorkspaceSidebar";

/**
 * Layout for routes that share the main navigation sidebar
 * (home, agents, book, co-writer, playground). /chat lives outside
 * this group with its own sidebar.
 */
export default function NavLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <WorkspaceSidebar />
      <main className="flex-1 overflow-hidden bg-[var(--background)]">
        {children}
      </main>
    </>
  );
}
