// クエーさん — サークル「クエーサー」のマスコット
// バレーボール（モルテン V5M5000 の白・赤・緑）を本体に、クエーサーの降着円盤を輪として重ねる。
// 色はすべて単色。mood で表情を変え、画面の状態（投票中・抽選待ち・当選）に反応させる。

type Mood = "normal" | "happy" | "wait" | "sad";

// モルテンのバレーボール (V5M5000) の白・赤・緑に合わせる
const RED = "#d6473f";
const GREEN = "#2f9e8b";
const RING = "#d6473f";
const LINE = "#1f2937";

export function Quasar({
  mood = "normal",
  size = 120,
  className = "",
}: {
  mood?: Mood;
  size?: number;
  className?: string;
}) {
  // clipPath の id は同一ページに複数置くと衝突するため mood ごとに分ける
  const uid = `quasar-${mood}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="クエーさん"
    >
      <defs>
        {/* ボールの内側だけにパネルを描くためのマスク */}
        <clipPath id={`${uid}-ball`}>
          <circle cx="60" cy="56" r="34" />
        </clipPath>
        {/* 輪の手前側だけを本体の上に重ねるための下半分マスク */}
        <clipPath id={`${uid}-front`}>
          <rect x="0" y="70" width="120" height="50" />
        </clipPath>
      </defs>

      {/* 降着円盤（奥側）— 本体の後ろを通る */}
      <ellipse
        cx="60"
        cy="72"
        rx="52"
        ry="13"
        stroke={RING}
        strokeWidth="5"
        fill="none"
        transform="rotate(-16 60 72)"
      />

      {/* ボール本体 */}
      <g clipPath={`url(#${uid}-ball)`}>
        <circle cx="60" cy="56" r="34" fill="#ffffff" />
        {/* 上の緑パネル */}
        <path d="M10 44 Q60 14 110 44 L110 30 Q60 0 10 30 Z" fill={GREEN} />
        {/* 下の赤パネル */}
        <path d="M10 80 Q60 50 110 80 L110 94 Q60 64 10 94 Z" fill={RED} />
        {/* パネルの継ぎ目 */}
        <path
          d="M10 44 Q60 14 110 44 M10 30 Q60 0 110 30 M10 80 Q60 50 110 80 M10 94 Q60 64 110 94"
          stroke={LINE}
          strokeWidth="1.2"
          fill="none"
          opacity="0.35"
        />
      </g>
      <circle cx="60" cy="56" r="34" stroke={LINE} strokeWidth="2" fill="none" />

      {/* 降着円盤（手前側）— 輪が本体を貫通して見えるようにする */}
      <g clipPath={`url(#${uid}-front)`}>
        <ellipse
          cx="60"
          cy="72"
          rx="52"
          ry="13"
          stroke={RING}
          strokeWidth="5"
          fill="none"
          transform="rotate(-16 60 72)"
        />
      </g>

      <Face mood={mood} />

      {/* きらめき */}
      <path
        d="M100 22 l2.2 5.8 5.8 2.2 -5.8 2.2 -2.2 5.8 -2.2 -5.8 -5.8 -2.2 5.8 -2.2z"
        fill={GREEN}
      />
      <path
        d="M18 30 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5z"
        fill={RED}
      />
    </svg>
  );
}

const CHEEK = "#fb7185";

function Face({ mood }: { mood: Mood }) {
  if (mood === "happy") {
    // 目を弧に、口を開けて全力で喜ぶ
    return (
      <g>
        <circle cx="40" cy="62" r="4.5" fill={CHEEK} opacity="0.75" />
        <circle cx="80" cy="62" r="4.5" fill={CHEEK} opacity="0.75" />
        <path
          d="M43 53 q5.5 -7 11 0 M66 53 q5.5 -7 11 0"
          stroke={LINE}
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
        {/* 開いた口 */}
        <path d="M50 62 q10 14 20 0 z" fill={LINE} />
        <path d="M55.5 68.5 q4.5 5 9 0 z" fill={CHEEK} />
      </g>
    );
  }

  if (mood === "wait") {
    // 目を閉じて上を向く。頭の上の「…」で待っている感じを出す
    return (
      <g>
        <path
          d="M42 55 q6 5 12 0 M66 55 q6 5 12 0"
          stroke={LINE}
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M55 68 q5 -3 10 0"
          stroke={LINE}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        <g fill={LINE} opacity="0.55">
          <circle cx="86" cy="36" r="2" />
          <circle cx="93" cy="32" r="2.4" />
          <circle cx="101" cy="27" r="2.8" />
        </g>
      </g>
    );
  }

  if (mood === "sad") {
    // 八の字の眉としょんぼりした口
    return (
      <g>
        <path
          d="M41 47 q6 3 11 6 M79 47 q-6 3 -11 6"
          stroke={LINE}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="48" cy="59" r="5" fill={LINE} />
        <circle cx="72" cy="59" r="5" fill={LINE} />
        <circle cx="49.5" cy="57" r="1.7" fill="#ffffff" />
        <circle cx="73.5" cy="57" r="1.7" fill="#ffffff" />
        <path
          d="M53 72 q7 -6 14 0"
          stroke={LINE}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      </g>
    );
  }

  // normal — 目を大きく離し、口角を上げた素の顔
  return (
    <g>
      <circle cx="47" cy="55" r="6" fill={LINE} />
      <circle cx="73" cy="55" r="6" fill={LINE} />
      <circle cx="49" cy="52.5" r="2.2" fill="#ffffff" />
      <circle cx="75" cy="52.5" r="2.2" fill="#ffffff" />
      <circle cx="37" cy="63" r="4" fill={CHEEK} opacity="0.65" />
      <circle cx="83" cy="63" r="4" fill={CHEEK} opacity="0.65" />
      <path
        d="M53 67 q7 7 14 0"
        stroke={LINE}
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </g>
  );
}
