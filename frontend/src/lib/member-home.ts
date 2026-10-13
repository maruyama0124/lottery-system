import type { Gender, MyResults, ParticipationTable, PracticeMonth, PracticeMonthDetail, UserProfile, VoteStatus } from "@/types/api";

/** メンバー向け公開APIだけを束ねる。管理用 /results は含めない。 */
export interface MemberHome {
  user: UserProfile;
  months: PracticeMonth[];
  detail: PracticeMonthDetail | null;
  voteStatus: VoteStatus | null;
  myResults: MyResults | null;
  participation: ParticipationTable | null;
}

export function userScope(user: UserProfile): string {
  return [user.id, user.gender, user.role, user.grade, user.is_manager, user.is_observer].join(":");
}

export async function loadMemberHome(
  get: <T>(path: string) => Promise<T>, gender: Gender, monthId: string | null,
): Promise<MemberHome> {
  // 認証済みの本人情報と月一覧は並行取得。クライアントの権限情報は信用しない。
  const [user, months] = await Promise.all([
    get<UserProfile>("/v1/users/me"),
    get<PracticeMonth[]>(`/v1/practice-months?gender=${gender}`),
  ]);
  const month = monthId ? months.find((m) => m.id === monthId) : months[0];
  if (!month) return { user, months, detail: null, voteStatus: null, myResults: null, participation: null };
  const base = `/v1/practice-months/${month.id}`;
  const own = user.gender === gender && !user.is_observer;
  const published = month.status === "published";
  const [detail, voteStatus, myResults, participation] = await Promise.all([
    get<PracticeMonthDetail>(base),
    own && !published ? get<VoteStatus>(`${base}/votes/me`) : null,
    own && published ? get<MyResults>(`${base}/results/me`) : null,
    published ? get<ParticipationTable>(`${base}/participation`) : null,
  ]);
  const becamePublished = !published && detail.status === "published";
  const [latestMine, latestTable] = becamePublished ? await Promise.all([
    own ? get<MyResults>(`${base}/results/me`) : null,
    get<ParticipationTable>(`${base}/participation`),
  ]) : [myResults, participation];
  // 取得途中に非公開へ変わった場合も、結果を混ぜない。
  return {
    user, months: months.map((m) => m.id === detail.id ? detail : m), detail,
    voteStatus: detail.status === "published" ? null : voteStatus,
    myResults: detail.status === "published" ? latestMine : null,
    participation: detail.status === "published" ? latestTable : null,
  };
}
