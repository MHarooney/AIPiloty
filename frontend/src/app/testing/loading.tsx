export default function TestingLoading() {
  return (
    <div className="flex h-screen bg-gray-950">
      <div className="hidden md:block w-64 border-r border-gray-800/50 bg-gray-900/40" />
      <div className="flex-1 flex flex-col animate-pulse">
        <div className="h-11 border-b border-gray-800/50 bg-gray-950/70" />
        <div className="h-12 border-b border-gray-800/40 bg-gray-900/30" />
        <div className="flex flex-1 min-h-0">
          <div className="flex-[3] border-r border-gray-800/40 p-6 space-y-4">
            <div className="mx-auto mt-16 h-16 w-16 rounded-2xl bg-emerald-900/30" />
            <div className="mx-auto h-4 w-40 rounded bg-gray-800/60" />
            <div className="mx-auto h-3 w-64 rounded bg-gray-800/40" />
            <div className="mx-auto mt-8 max-w-sm space-y-2">
              <div className="h-10 rounded-xl bg-gray-900/60" />
              <div className="h-10 rounded-xl bg-gray-900/60" />
              <div className="h-10 rounded-xl bg-gray-900/60" />
            </div>
          </div>
          <div className="flex-[2] p-4 space-y-3">
            <div className="h-8 w-32 rounded bg-gray-800/50" />
            <div className="h-40 rounded-xl bg-gray-900/50" />
            <div className="grid grid-cols-4 gap-2">
              <div className="h-16 rounded-lg bg-gray-900/40" />
              <div className="h-16 rounded-lg bg-gray-900/40" />
              <div className="h-16 rounded-lg bg-gray-900/40" />
              <div className="h-16 rounded-lg bg-gray-900/40" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
