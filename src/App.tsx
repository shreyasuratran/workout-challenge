import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Check,
  ChevronRight,
  Crown,
  Gift,
  History,
  Home,
  Loader2,
  RotateCcw,
  Settings,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { differenceInCalendarDays, format, isWeekend, parseISO, subDays } from 'date-fns';
import { currentStreak, isRecentFirst, todayKey, weekRange } from './lib/dates';
import { hasSupabaseConfig, supabase } from './lib/supabase';
import type { CheckIn, Profile, View } from './types';

const SELECTED_PROFILE_KEY = 'workout-challenge-selected-profile-id';
const NOTE_LIMIT = 120;

const avatarPresets = [
  { label: 'Bunny', emoji: '🐰' },
  { label: 'Cat', emoji: '🐱' },
  { label: 'Dog', emoji: '🐶' },
  { label: 'Bear', emoji: '🐻' },
  { label: 'Frog', emoji: '🐸' },
  { label: 'Penguin', emoji: '🐧' },
  { label: 'Butterfly', emoji: '🦋' },
  { label: 'Star', emoji: '⭐' },
  { label: 'Cherry', emoji: '🍒' },
  { label: 'Flower', emoji: '🌸' },
  { label: 'Lightning', emoji: '⚡' },
  { label: 'Fire', emoji: '🔥' },
] as const;

const themePresets = [
  { label: 'Strawberry', value: 'strawberry' },
  { label: 'Peach', value: 'peach' },
  { label: 'Lavender', value: 'lavender' },
  { label: 'Mint', value: 'mint' },
  { label: 'Sky', value: 'sky' },
  { label: 'Lemon', value: 'lemon' },
] as const;

const dailyChallenges = [
  'Get one workout on the board.',
  'Do the version of movement you can actually finish.',
  'Make today count, even if it is short.',
  'Protect the streak.',
  'Tiny workout still counts.',
  'Weekend movement counts too.',
  'Beat the couch today.',
];

type ThemeValue = (typeof themePresets)[number]['value'];

type ChallengeStat = {
  profile: Profile;
  dates: string[];
  todayCheckIn: CheckIn | undefined;
  weeklyCount: number;
  streak: number;
};

type Badge = {
  label: string;
  unlocked: boolean;
  icon: string;
};

type Tab = {
  id: View;
  label: string;
  icon: typeof Home;
};

const tabs: Tab[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'leaderboard', label: 'Race', icon: Trophy },
  { id: 'history', label: 'Wins', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const themeStyles: Record<
  ThemeValue,
  {
    shell: string;
    soft: string;
    strong: string;
    text: string;
    ring: string;
    bar: string;
    dot: string;
  }
> = {
  strawberry: {
    shell: 'from-rose-100 via-orange-50 to-pink-100',
    soft: 'bg-rose-100',
    strong: 'bg-rose-500',
    text: 'text-rose-700',
    ring: 'ring-rose-200',
    bar: 'bg-rose-500',
    dot: 'bg-rose-300',
  },
  peach: {
    shell: 'from-orange-100 via-amber-50 to-pink-100',
    soft: 'bg-orange-100',
    strong: 'bg-orange-400',
    text: 'text-orange-700',
    ring: 'ring-orange-200',
    bar: 'bg-orange-400',
    dot: 'bg-orange-300',
  },
  lavender: {
    shell: 'from-violet-100 via-fuchsia-50 to-rose-50',
    soft: 'bg-violet-100',
    strong: 'bg-violet-500',
    text: 'text-violet-700',
    ring: 'ring-violet-200',
    bar: 'bg-violet-500',
    dot: 'bg-violet-300',
  },
  mint: {
    shell: 'from-emerald-100 via-teal-50 to-lime-50',
    soft: 'bg-emerald-100',
    strong: 'bg-emerald-500',
    text: 'text-emerald-700',
    ring: 'ring-emerald-200',
    bar: 'bg-emerald-500',
    dot: 'bg-emerald-300',
  },
  sky: {
    shell: 'from-sky-100 via-cyan-50 to-indigo-50',
    soft: 'bg-sky-100',
    strong: 'bg-sky-500',
    text: 'text-sky-700',
    ring: 'ring-sky-200',
    bar: 'bg-sky-500',
    dot: 'bg-sky-300',
  },
  lemon: {
    shell: 'from-yellow-100 via-amber-50 to-lime-50',
    soft: 'bg-yellow-100',
    strong: 'bg-yellow-400',
    text: 'text-yellow-800',
    ring: 'ring-yellow-200',
    bar: 'bg-yellow-400',
    dot: 'bg-yellow-300',
  },
};

const getTheme = (profile?: Profile | null) => {
  const value = profile?.theme_color as ThemeValue | undefined;
  return themeStyles[value && value in themeStyles ? value : 'strawberry'];
};

const getAvatar = (profile: Profile) => profile.avatar_emoji || '🌸';

const dailyChallengeFor = (dateKey: string) => {
  const total = [...dateKey].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return dailyChallenges[total % dailyChallenges.length];
};

const describeDay = (dateKey: string) => {
  const diff = differenceInCalendarDays(new Date(), parseISO(dateKey));
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  return format(parseISO(dateKey), 'MMM d');
};

function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(() => {
    return localStorage.getItem(SELECTED_PROFILE_KEY) ?? '';
  });
  const [view, setView] = useState<View>('home');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const activeTheme = getTheme(selectedProfile);
  const today = todayKey();
  const week = weekRange();

  const loadData = useCallback(async () => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const since = subDays(new Date(), 70);
    const [profilesResult, checkInsResult] = await Promise.all([
      supabase.from('profiles').select('*').order('name'),
      supabase
        .from('check_ins')
        .select('*')
        .gte('check_in_date', format(since, 'yyyy-MM-dd'))
        .order('check_in_date', { ascending: false })
        .order('created_at', { ascending: false }),
    ]);

    if (profilesResult.error) {
      setError(profilesResult.error.message);
    } else if (checkInsResult.error) {
      setError(checkInsResult.error.message);
    } else {
      setProfiles((profilesResult.data ?? []) as Profile[]);
      setCheckIns((checkInsResult.data ?? []) as CheckIn[]);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (selectedProfileId) {
      localStorage.setItem(SELECTED_PROFILE_KEY, selectedProfileId);
    }
  }, [selectedProfileId]);

  const checkInsByProfile = useMemo<ChallengeStat[]>(() => {
    return profiles.map((profile) => {
      const dates = checkIns
        .filter((checkIn) => checkIn.profile_id === profile.id)
        .map((checkIn) => checkIn.check_in_date);
      const todayCheckIn = checkIns.find(
        (checkIn) => checkIn.profile_id === profile.id && checkIn.check_in_date === today,
      );
      const weeklyCount = dates.filter((date) => week.days.includes(date)).length;

      return {
        profile,
        dates,
        todayCheckIn,
        weeklyCount,
        streak: currentStreak(dates),
      };
    });
  }, [checkIns, profiles, today, week.days]);

  const leaderboard = useMemo(() => {
    return [...checkInsByProfile].sort((a, b) => {
      if (b.weeklyCount !== a.weeklyCount) return b.weeklyCount - a.weeklyCount;
      return b.streak - a.streak;
    });
  }, [checkInsByProfile]);

  const selectedStats = checkInsByProfile.find((entry) => entry.profile.id === selectedProfileId);
  const hasCheckedInToday = Boolean(selectedStats?.todayCheckIn);
  const recentCheckIns = useMemo(() => {
    return [...checkIns]
      .sort((a, b) => {
        const dateOrder = isRecentFirst(a.check_in_date, b.check_in_date);
        if (dateOrder !== 0) return dateOrder;
        return b.created_at.localeCompare(a.created_at);
      })
      .slice(0, 24);
  }, [checkIns]);

  const pickProfile = (profileId: string) => {
    setSelectedProfileId(profileId);
    localStorage.setItem(SELECTED_PROFILE_KEY, profileId);
    setView('home');
  };

  const checkInToday = async () => {
    if (!supabase || !selectedProfile || hasCheckedInToday) return;

    setIsSaving(true);
    setError(null);
    const trimmedNote = noteText.trim().slice(0, NOTE_LIMIT);
    const payload: { profile_id: string; check_in_date: string; note_text?: string } = {
      profile_id: selectedProfile.id,
      check_in_date: today,
    };
    if (trimmedNote) {
      payload.note_text = trimmedNote;
    }

    const result = await supabase.from('check_ins').insert(payload).select().single();

    if (result.error) {
      setError(result.error.message);
    } else {
      setCheckIns((existing) => [result.data as CheckIn, ...existing]);
      setNoteText('');
    }
    setIsSaving(false);
  };

  const undoToday = async () => {
    if (!supabase || !selectedStats?.todayCheckIn) return;

    setIsSaving(true);
    setError(null);
    const result = await supabase.from('check_ins').delete().eq('id', selectedStats.todayCheckIn.id);

    if (result.error) {
      setError(result.error.message);
    } else {
      setCheckIns((existing) => existing.filter((checkIn) => checkIn.id !== selectedStats.todayCheckIn?.id));
    }
    setIsSaving(false);
  };

  const updateProfile = async (profileId: string, updates: Partial<Pick<Profile, 'weekly_goal' | 'avatar_emoji' | 'theme_color'>>) => {
    if (!supabase) return;

    setError(null);
    setProfiles((existing) =>
      existing.map((profile) => (profile.id === profileId ? { ...profile, ...updates } : profile)),
    );

    const result = await supabase.from('profiles').update(updates).eq('id', profileId);
    if (result.error) {
      setError(result.error.message);
      void loadData();
    }
  };

  if (!hasSupabaseConfig) {
    return <MissingConfig />;
  }

  if (isLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-rose-50 px-6 text-slate-900">
        <div className="flex items-center gap-3 rounded-full bg-white px-5 py-3 shadow-soft">
          <Loader2 className="h-5 w-5 animate-spin text-rose-500" />
          <span className="font-semibold">Loading the challenge...</span>
        </div>
      </main>
    );
  }

  return (
    <main className={`min-h-screen bg-gradient-to-br ${activeTheme.shell} pb-28 text-slate-950`}>
      <div className="pointer-events-none fixed inset-x-0 top-0 mx-auto h-52 max-w-md overflow-hidden">
        <div className={`absolute -left-8 top-10 h-20 w-20 rounded-full ${activeTheme.dot} opacity-40 blur-sm`} />
        <div className="absolute right-6 top-8 h-8 w-8 rotate-12 rounded-md bg-white/70" />
        <div className="absolute right-20 top-28 h-4 w-14 -rotate-6 rounded-full bg-white/60" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-6 pt-5">
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className={`text-sm font-black uppercase tracking-[0.16em] ${activeTheme.text}`}>Private challenge</p>
            <h1 className="mt-1 text-3xl font-black leading-tight">Workout Wins</h1>
          </div>
          <button
            className="grid h-12 w-12 place-items-center rounded-2xl bg-white/90 text-slate-800 shadow-sm ring-1 ring-white"
            onClick={loadData}
            aria-label="Refresh challenge data"
          >
            <RotateCcw className="h-5 w-5" />
          </button>
        </header>

        {error ? (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {error}
          </div>
        ) : null}

        {!selectedProfile ? (
          <ProfilePicker profiles={profiles} onPick={pickProfile} />
        ) : (
          <>
            {view === 'home' ? (
              <HomeView
                checkInsByProfile={checkInsByProfile}
                hasCheckedInToday={hasCheckedInToday}
                isSaving={isSaving}
                noteText={noteText}
                onCheckIn={checkInToday}
                onNoteChange={setNoteText}
                onUndo={undoToday}
                recentCheckIns={recentCheckIns.slice(0, 10)}
                selectedProfile={selectedProfile}
                selectedStats={selectedStats}
                today={today}
              />
            ) : null}
            {view === 'leaderboard' ? <LeaderboardView leaderboard={leaderboard} week={week} /> : null}
            {view === 'history' ? <HistoryView checkIns={recentCheckIns} profiles={profiles} /> : null}
            {view === 'settings' ? (
              <SettingsView
                profiles={profiles}
                selectedProfileId={selectedProfileId}
                onPickProfile={pickProfile}
                onUpdateProfile={updateProfile}
              />
            ) : null}
          </>
        )}
      </div>

      {selectedProfile ? <BottomNav currentView={view} onChange={setView} /> : null}
    </main>
  );
}

function MissingConfig() {
  return (
    <main className="grid min-h-screen place-items-center bg-rose-50 px-5 text-slate-950">
      <section className="w-full max-w-md rounded-3xl bg-white p-5 shadow-soft">
        <h1 className="text-2xl font-black">Supabase env needed</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Add your local Supabase values to <span className="font-mono text-slate-900">.env.local</span> using
          the names in <span className="font-mono text-slate-900">.env.example</span>, then restart Vite.
        </p>
      </section>
    </main>
  );
}

function ProfilePicker({ profiles, onPick }: { profiles: Profile[]; onPick: (profileId: string) => void }) {
  return (
    <section className="mt-4">
      <div className="rounded-[2rem] bg-white/90 p-5 shadow-soft ring-1 ring-white">
        <div className="flex -space-x-3">
          {profiles.map((profile) => (
            <AvatarBubble key={profile.id} profile={profile} size="md" />
          ))}
        </div>
        <h2 className="mt-5 text-2xl font-black">Pick your player</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Three friends. One tiny scoreboard. Big main character energy.</p>
        <div className="mt-5 grid gap-3">
          {profiles.map((profile) => {
            const theme = getTheme(profile);
            return (
              <button
                key={profile.id}
                className={`flex items-center gap-3 rounded-3xl border border-white bg-white px-4 py-4 text-left font-bold text-slate-950 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft ${theme.ring}`}
                onClick={() => onPick(profile.id)}
              >
                <AvatarBubble profile={profile} size="sm" />
                <span className="flex-1">{profile.name}</span>
                <span className={`rounded-full ${theme.soft} px-3 py-1 text-xs ${theme.text}`}>
                  {profile.weekly_goal}/week
                </span>
              </button>
            );
          })}
          {profiles.length === 0 ? (
            <p className="rounded-2xl bg-yellow-50 px-4 py-3 text-sm font-medium text-yellow-900">
              Run the Supabase schema seed first so Shreya, Aditi, and Thaanvi can join.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function HomeView({
  checkInsByProfile,
  hasCheckedInToday,
  isSaving,
  noteText,
  onCheckIn,
  onNoteChange,
  onUndo,
  recentCheckIns,
  selectedProfile,
  selectedStats,
  today,
}: {
  checkInsByProfile: ChallengeStat[];
  hasCheckedInToday: boolean;
  isSaving: boolean;
  noteText: string;
  onCheckIn: () => void;
  onNoteChange: (note: string) => void;
  onUndo: () => void;
  recentCheckIns: CheckIn[];
  selectedProfile: Profile;
  selectedStats: ChallengeStat | undefined;
  today: string;
}) {
  const theme = getTheme(selectedProfile);
  const badges = getBadges(selectedStats);

  return (
    <div className="grid gap-5">
      <section className="relative overflow-hidden rounded-[2rem] bg-slate-950 p-5 text-white shadow-soft">
        <div className={`absolute -right-10 -top-10 h-36 w-36 rounded-full ${theme.strong} opacity-30`} />
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-white/70">{format(parseISO(today), 'EEEE, MMM d')}</p>
            <h2 className="mt-1 text-2xl font-black">Daily Mission</h2>
            <p className="mt-2 max-w-[13rem] text-sm leading-6 text-white/75">{dailyChallengeFor(today)}</p>
          </div>
          <div className="rounded-[1.7rem] bg-white p-2 shadow-lg">
            <AvatarBubble profile={selectedProfile} size="lg" />
          </div>
        </div>

        <div className="relative mt-5 grid grid-cols-2 gap-3">
          <Metric label="Streak" value={`${selectedStats?.streak ?? 0}`} detail="days" />
          <Metric label="This week" value={`${selectedStats?.weeklyCount ?? 0}/${selectedProfile.weekly_goal}`} detail="goal" />
        </div>

        {!hasCheckedInToday ? (
          <label className="relative mt-4 block">
            <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-white/60">Add a quick note?</span>
            <input
              className="min-h-12 w-full rounded-2xl border border-white/10 bg-white/10 px-4 text-sm font-semibold text-white placeholder:text-white/40 outline-none focus:border-white/40"
              maxLength={NOTE_LIMIT}
              onChange={(event) => onNoteChange(event.target.value.slice(0, NOTE_LIMIT))}
              placeholder="quick walk, yoga, lift..."
              value={noteText}
            />
            <span className="mt-1 block text-right text-[11px] font-semibold text-white/40">{noteText.length}/{NOTE_LIMIT}</span>
          </label>
        ) : null}

        <button
          className={`relative mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl ${hasCheckedInToday ? 'bg-white/10 text-white' : 'bg-white text-slate-950'} px-4 py-4 text-base font-black shadow-sm transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70`}
          onClick={hasCheckedInToday ? onUndo : onCheckIn}
          disabled={isSaving}
        >
          {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : hasCheckedInToday ? <RotateCcw className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
          {hasCheckedInToday ? 'Undo today' : 'Log today’s win'}
        </button>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-black">Today&apos;s Board</h2>
          <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-black text-slate-500 shadow-sm">
            {checkInsByProfile.filter((entry) => entry.todayCheckIn).length}/3 in
          </span>
        </div>
        <div className="grid gap-3">
          {checkInsByProfile.map(({ profile, todayCheckIn, streak, weeklyCount }) => (
            <BoardCard
              key={profile.id}
              profile={profile}
              streak={streak}
              todayCheckIn={todayCheckIn}
              weeklyCount={weeklyCount}
            />
          ))}
        </div>
      </section>

      <BadgeShelf badges={badges} />
      <RecentWins checkIns={recentCheckIns} profiles={checkInsByProfile.map((entry) => entry.profile)} />
    </div>
  );
}

function LeaderboardView({ leaderboard, week }: { leaderboard: ChallengeStat[]; week: ReturnType<typeof weekRange> }) {
  return (
    <section className="grid gap-4">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">Weekly Race</p>
        <h2 className="text-3xl font-black">Who&apos;s ahead?</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">
          {format(parseISO(week.start), 'MMM d')} - {format(parseISO(week.end), 'MMM d')}
        </p>
      </div>
      <div className="grid gap-3">
        {leaderboard.map(({ profile, weeklyCount, streak }, index) => {
          const theme = getTheme(profile);
          return (
            <div key={profile.id} className="relative overflow-hidden rounded-[1.75rem] bg-white/90 p-4 shadow-sm ring-1 ring-white">
              <div className={`absolute right-4 top-4 h-16 w-16 rounded-full ${theme.soft} opacity-60`} />
              <div className="relative flex items-center gap-3">
                <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl font-black ${index === 0 ? 'bg-yellow-100 text-yellow-800' : 'bg-slate-100 text-slate-600'}`}>
                  {index === 0 ? <Crown className="h-6 w-6" /> : index + 1}
                </div>
                <AvatarBubble profile={profile} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="font-black">{profile.name}</p>
                  <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${theme.bar}`} style={{ width: `${Math.min((weeklyCount / Math.max(profile.weekly_goal, 1)) * 100, 100)}%` }} />
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-black">{weeklyCount}</p>
                  <p className="text-xs font-semibold text-slate-500">{streak} streak</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HistoryView({ checkIns, profiles }: { checkIns: CheckIn[]; profiles: Profile[] }) {
  return (
    <section>
      <p className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">Recent Wins</p>
      <h2 className="text-3xl font-black">Activity feed</h2>
      <div className="mt-4 grid gap-3">
        {checkIns.map((checkIn) => {
          const profile = profiles.find((item) => item.id === checkIn.profile_id);
          return (
            <div key={checkIn.id} className="rounded-[1.5rem] bg-white/90 p-4 shadow-sm ring-1 ring-white">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {profile ? <AvatarBubble profile={profile} size="sm" /> : <div className="h-11 w-11 rounded-2xl bg-slate-100" />}
                  <div className="min-w-0">
                    <p className="font-black">{profile?.name ?? 'Friend'} checked in {describeDay(checkIn.check_in_date)}.</p>
                    <p className="text-sm text-slate-500">{format(parseISO(checkIn.check_in_date), 'EEEE, MMM d')}</p>
                  </div>
                </div>
                <CalendarDays className="h-5 w-5 shrink-0 text-slate-300" />
              </div>
              {checkIn.note_text ? (
                <p className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
                  “{checkIn.note_text}”
                </p>
              ) : null}
            </div>
          );
        })}
        {checkIns.length === 0 ? (
          <p className="rounded-2xl bg-white p-4 text-sm font-medium text-slate-500 shadow-sm">
            No wins yet. The first tap gets the scoreboard moving.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function SettingsView({
  profiles,
  selectedProfileId,
  onPickProfile,
  onUpdateProfile,
}: {
  profiles: Profile[];
  selectedProfileId: string;
  onPickProfile: (profileId: string) => void;
  onUpdateProfile: (profileId: string, updates: Partial<Pick<Profile, 'weekly_goal' | 'avatar_emoji' | 'theme_color'>>) => void;
}) {
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);

  return (
    <section className="grid gap-5">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">Settings</p>
        <h2 className="text-3xl font-black">Customize your corner</h2>
      </div>

      {selectedProfile ? (
        <div className="rounded-[2rem] bg-white/90 p-4 shadow-sm ring-1 ring-white">
          <div className="flex items-center gap-3">
            <AvatarBubble profile={selectedProfile} size="md" />
            <div>
              <p className="text-sm font-bold text-slate-500">Current player</p>
              <p className="text-xl font-black">{selectedProfile.name}</p>
            </div>
          </div>

          <h3 className="mt-5 text-sm font-black uppercase tracking-[0.14em] text-slate-500">Avatar</h3>
          <div className="mt-3 grid grid-cols-6 gap-2">
            {avatarPresets.map((avatar) => (
              <button
                key={avatar.label}
                className={`grid h-12 place-items-center rounded-2xl text-xl shadow-sm ${selectedProfile.avatar_emoji === avatar.emoji ? 'bg-slate-950 ring-2 ring-slate-950' : 'bg-slate-50'}`}
                onClick={() => onUpdateProfile(selectedProfile.id, { avatar_emoji: avatar.emoji })}
                aria-label={`Choose ${avatar.label} avatar`}
              >
                {avatar.emoji}
              </button>
            ))}
          </div>

          <h3 className="mt-5 text-sm font-black uppercase tracking-[0.14em] text-slate-500">Theme</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {themePresets.map((theme) => {
              const style = themeStyles[theme.value];
              return (
                <button
                  key={theme.value}
                  className={`flex min-h-12 items-center gap-2 rounded-2xl px-3 text-sm font-black shadow-sm ${selectedProfile.theme_color === theme.value ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-700'}`}
                  onClick={() => onUpdateProfile(selectedProfile.id, { theme_color: theme.value })}
                >
                  <span className={`h-4 w-4 rounded-full ${style.strong}`} />
                  {theme.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div>
        <h3 className="mb-3 text-sm font-black uppercase tracking-[0.14em] text-slate-500">Weekly goals</h3>
        <div className="grid gap-3">
          {profiles.map((profile) => {
            const theme = getTheme(profile);
            return (
              <div key={profile.id} className="rounded-[1.5rem] bg-white/90 p-4 shadow-sm ring-1 ring-white">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AvatarBubble profile={profile} size="xs" />
                    <p className="font-black">{profile.name}</p>
                  </div>
                  <p className={`text-sm font-bold ${theme.text}`}>{profile.weekly_goal} days/week</p>
                </div>
                <input
                  className="mt-4 w-full"
                  style={{ accentColor: 'currentColor' }}
                  type="range"
                  min="1"
                  max="7"
                  step="1"
                  value={profile.weekly_goal}
                  onChange={(event) => onUpdateProfile(profile.id, { weekly_goal: Number(event.target.value) })}
                  aria-label={`${profile.name} weekly goal`}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-black uppercase tracking-[0.14em] text-slate-500">Switch profile</h3>
        <div className="grid grid-cols-3 gap-2">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              className={`min-h-14 rounded-2xl px-2 text-sm font-black shadow-sm ${profile.id === selectedProfileId ? 'bg-slate-950 text-white' : 'bg-white/90 text-slate-700'}`}
              onClick={() => onPickProfile(profile.id)}
            >
              <span className="mb-1 block text-lg leading-none">{getAvatar(profile)}</span>
              {profile.name}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function BoardCard({
  profile,
  streak,
  todayCheckIn,
  weeklyCount,
}: {
  profile: Profile;
  streak: number;
  todayCheckIn: CheckIn | undefined;
  weeklyCount: number;
}) {
  const theme = getTheme(profile);

  return (
    <div className="flex items-center justify-between rounded-[1.5rem] bg-white/90 p-4 shadow-sm ring-1 ring-white">
      <div className="flex min-w-0 items-center gap-3">
        <AvatarBubble profile={profile} size="sm" />
        <div className="min-w-0">
          <p className="font-black">{profile.name}</p>
          <p className="mt-1 text-sm text-slate-500">
            {streak} day streak · {weeklyCount}/{profile.weekly_goal} this week
          </p>
        </div>
      </div>
      <div
        className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${
          todayCheckIn ? `${theme.soft} ${theme.text}` : 'bg-slate-100 text-slate-400'
        }`}
        aria-label={todayCheckIn ? 'Checked in today' : 'Not checked in today'}
      >
        {todayCheckIn ? <Check className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
      </div>
    </div>
  );
}

function BadgeShelf({ badges }: { badges: Badge[] }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Gift className="h-5 w-5 text-slate-500" />
        <h2 className="text-lg font-black">Badge Shelf</h2>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {badges.map((badge) => (
          <div
            key={badge.label}
            className={`rounded-[1.4rem] p-3 shadow-sm ring-1 ring-white ${
              badge.unlocked ? 'bg-white/95 text-slate-950' : 'bg-white/45 text-slate-400'
            }`}
          >
            <div className={`mb-2 grid h-10 w-10 place-items-center rounded-2xl text-lg ${badge.unlocked ? 'bg-yellow-100' : 'bg-slate-100 grayscale'}`}>
              {badge.icon}
            </div>
            <p className="text-sm font-black">{badge.label}</p>
            <p className="mt-1 text-xs font-bold">{badge.unlocked ? 'Unlocked' : 'Locked'}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentWins({ checkIns, profiles }: { checkIns: CheckIn[]; profiles: Profile[] }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-black">Recent Wins</h2>
      <div className="grid gap-3">
        {checkIns.map((checkIn) => {
          const profile = profiles.find((item) => item.id === checkIn.profile_id);
          const note = checkIn.note_text?.trim();
          return (
            <div key={checkIn.id} className="flex items-start gap-3 rounded-[1.5rem] bg-white/80 p-3 shadow-sm ring-1 ring-white">
              {profile ? <AvatarBubble profile={profile} size="xs" /> : null}
              <p className="min-w-0 flex-1 text-sm font-semibold leading-6 text-slate-600">
                {note
                  ? `${profile?.name ?? 'Friend'} added: “${note}”.`
                  : `${profile?.name ?? 'Friend'} ${describeDay(checkIn.check_in_date) === 'yesterday' ? 'logged a win yesterday' : `checked in ${describeDay(checkIn.check_in_date)}`}.`}
              </p>
            </div>
          );
        })}
        {checkIns.length === 0 ? (
          <p className="rounded-2xl bg-white/80 p-4 text-sm font-semibold text-slate-500 shadow-sm">No wins yet.</p>
        ) : null}
      </div>
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl bg-white/10 p-3">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/60">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
      <p className="text-sm font-medium text-white/60">{detail}</p>
    </div>
  );
}

function AvatarBubble({ profile, size }: { profile: Profile; size: 'xs' | 'sm' | 'md' | 'lg' }) {
  const theme = getTheme(profile);
  const sizes = {
    xs: 'h-9 w-9 text-lg rounded-2xl',
    sm: 'h-11 w-11 text-xl rounded-2xl',
    md: 'h-14 w-14 text-2xl rounded-3xl',
    lg: 'h-20 w-20 text-4xl rounded-[1.7rem]',
  };

  return (
    <div className={`grid shrink-0 place-items-center ${sizes[size]} ${theme.soft} ${theme.text} shadow-sm ring-2 ring-white`}>
      <span aria-hidden="true">{getAvatar(profile)}</span>
    </div>
  );
}

function BottomNav({ currentView, onChange }: { currentView: View; onChange: (view: View) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-white/70 bg-white/90 px-3 pb-4 pt-2 backdrop-blur">
      <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentView === tab.id;
          return (
            <button
              key={tab.id}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-black ${
                isActive ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500'
              }`}
              onClick={() => onChange(tab.id)}
            >
              <Icon className="h-5 w-5" />
              {tab.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function getBadges(stats: ChallengeStat | undefined): Badge[] {
  const dates = new Set(stats?.dates ?? []);
  const week = weekRange();
  const hadPreviousTwoDays =
    dates.has(format(subDays(new Date(), 1), 'yyyy-MM-dd')) ||
    dates.has(format(subDays(new Date(), 2), 'yyyy-MM-dd'));
  const weekendThisWeek = week.days.some((day) => dates.has(day) && isWeekend(parseISO(day)));

  return [
    { label: 'First Win', unlocked: dates.size >= 1, icon: '🏁' },
    { label: '3-Day Streak', unlocked: (stats?.streak ?? 0) >= 3, icon: '✨' },
    { label: '5-Day Streak', unlocked: (stats?.streak ?? 0) >= 5, icon: '🔥' },
    { label: 'Goal Crusher', unlocked: (stats?.weeklyCount ?? 0) >= (stats?.profile.weekly_goal ?? 4), icon: '💪' },
    { label: 'Perfect Week', unlocked: (stats?.weeklyCount ?? 0) >= 7, icon: '👑' },
    { label: 'Weekend Warrior', unlocked: weekendThisWeek, icon: '🌈' },
    { label: 'Comeback', unlocked: Boolean(stats?.todayCheckIn) && !hadPreviousTwoDays && dates.size > 1, icon: '⭐' },
  ];
}

export default App;
