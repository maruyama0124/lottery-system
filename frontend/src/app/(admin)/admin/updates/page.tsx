"use client";

import { AdminHeader } from "@/components/admin/header";
import { Loading } from "@/components/ui/loading";
import { useRequireRepresentative } from "@/hooks/use-auth";
import { releaseNotes } from "@/lib/release-notes";

export default function AdminUpdatesPage() {
  const { user, isLoading } = useRequireRepresentative();
  if (isLoading || !user || user.role !== "representative") return <Loading />;

  return (
    <>
      <AdminHeader title="アップデート履歴" />
      <main className="space-y-5 px-4 py-5">
        <section className="rounded-2xl border border-brand-100 bg-brand-50 p-4">
          <p className="text-sm font-bold text-brand-800">クエーさんの、これまでのアップデート</p>
        </section>

        <ol aria-label="新しい順の更新履歴" className="space-y-4">
          {releaseNotes.map((note, index) => (
            <li key={note.id}>
              <article aria-labelledby={`update-${note.id}`} className={`rounded-2xl border bg-white p-4 ${index === 0 ? "border-brand-200" : "border-gray-200"}`}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">{note.category}</span>
                  {index === 0 && <span className="rounded bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white">最新</span>}
                </div>
                <h2 id={`update-${note.id}`} className="text-sm font-bold leading-relaxed text-gray-900">{note.title}</h2>
                <ul className="mt-3 list-disc space-y-2 pl-4 text-xs leading-relaxed text-gray-600">
                  {note.changes.map((change) => {
                    const start = note.highlight ? change.indexOf(note.highlight) : -1;
                    return (
                      <li key={change}>
                        {start >= 0 && note.highlight ? <>
                          {change.slice(0, start)}
                          <strong className="font-bold text-brand-700">{note.highlight}</strong>
                          {change.slice(start + note.highlight.length)}
                        </> : change}
                      </li>
                    );
                  })}
                </ul>
              </article>
            </li>
          ))}
        </ol>
      </main>
    </>
  );
}
