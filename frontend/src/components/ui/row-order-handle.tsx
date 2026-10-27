"use client";

import type { ButtonHTMLAttributes } from "react";

export function RowOrderHandle({ name, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { name: string }) {
  return (
    <button
      {...props}
      type="button"
      aria-label={`${name}の行を並べ替え`}
      title="ドラッグ、または上下キーで同学年内を並べ替え"
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
      className="inline-flex h-8 w-7 shrink-0 touch-none select-none items-center justify-center rounded text-gray-400 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-brand-600 active:cursor-grabbing disabled:opacity-25 cursor-grab"
    >
      <svg aria-hidden="true" width="12" height="18" viewBox="0 0 12 18" fill="currentColor">
        {[4, 9, 14].flatMap((y) => [3, 9].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" />))}
      </svg>
    </button>
  );
}
