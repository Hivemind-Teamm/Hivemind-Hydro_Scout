// app/unauthorized/page.tsx

export default function UnauthorizedPage() {
  return (
    <div className="mx-auto mt-20 max-w-[480px] p-6 text-center">
      <h1 className="mb-3 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Access denied</h1>
      <p className="text-neutral-600 dark:text-neutral-400">
        Your account role doesn&apos;t have permission to view this page.
      </p>
    </div>
  );
}