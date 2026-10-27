"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { KeyboardEvent, PointerEvent } from "react";
import { beginMemberRowDrag } from "@/lib/member-row-drag";
import {
  EMPTY_ROW_ORDER, MemberRowOrderStore, ROW_ORDER_PREFIX, memberGroup, orderMembers,
  type OrderedMember, type RowOrderMode,
} from "@/lib/member-row-order";

const stores = new Map<string, MemberRowOrderStore>();
const serverSnapshot = () => EMPTY_ROW_ORDER;
function getStore(userId: string | undefined, gender: string | undefined, mode: RowOrderMode) {
  const scope = [userId ?? "", gender ?? ""];
  if (mode === "mixed") scope.push("admin-matrix");
  const key = ROW_ORDER_PREFIX + JSON.stringify(scope);
  let store = stores.get(key);
  if (!store) {
    let storage: Storage | undefined;
    try { if (typeof window !== "undefined" && userId && gender) storage = window.localStorage; } catch { /* optional */ }
    store = new MemberRowOrderStore(key, storage, mode);
    stores.set(key, store);
  }
  return store;
}

export function useMemberRowOrder(
  userId: string | undefined, gender: string | undefined,
  members: readonly OrderedMember[], disabled = false, mode: RowOrderMode = "separate",
) {
  const store = useMemo(() => getStore(userId, gender, mode), [userId, gender, mode]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, serverSnapshot);
  const latest = useRef({ members, disabled });
  useEffect(() => { latest.current = { members, disabled }; }, [members, disabled]);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    const refresh = (event: StorageEvent) => { if (event.key === store.key || event.key === null) store.reload(); };
    store.reload();
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("storage", refresh); cleanup.current?.(); };
  }, [store]);
  // 別タブなどから保存順が変わった場合は、古いドラッグを確定しない。
  useEffect(() => { cleanup.current?.(); }, [state.orders]);

  const sort = <T extends OrderedMember>(rows: readonly T[]) => orderMembers(rows, state.orders, mode);
  const handleProps = (member: OrderedMember, zone: string, visible: readonly OrderedMember[] = members) => {
    const peers = sort(visible).filter((m) => memberGroup(m, mode) === memberGroup(member, mode));
    return {
      disabled: disabled || !userId || !gender || peers.length < 2,
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (latest.current.disabled || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
        event.preventDefault(); event.stopPropagation();
        const index = peers.findIndex((m) => m.user_id === member.user_id);
        const target = peers[index + (event.key === "ArrowUp" ? -1 : 1)];
        if (target) store.move(member.user_id, target.user_id, latest.current.members);
      },
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0 || !event.isPrimary || latest.current.disabled || peers.length < 2 || cleanup.current) return;
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.focus();
        cleanup.current = beginMemberRowDrag({
          handle: event.currentTarget, pointerId: event.pointerId,
          x: event.clientX, y: event.clientY, member, zone, group: memberGroup(member, mode),
          disabled: () => latest.current.disabled,
          commit: (targetId) => {
            flushSync(() => { store.move(member.user_id, targetId, latest.current.members); });
          },
          finished: () => { cleanup.current = null; },
        });
      },
    };
  };
  const rowProps = (member: OrderedMember, zone: string) => ({
    "data-row-order-id": member.user_id,
    "data-row-order-zone": zone,
    "data-row-order-group": memberGroup(member, mode),
    "data-row-order-manager": String(member.is_manager),
  });
  return { sort, handleProps, rowProps, error: state.error };
}
