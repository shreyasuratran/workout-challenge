import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Check,
  Flame,
  History,
  Home,
  Loader2,
  Medal,
  RotateCcw,
  Settings,
  Trophy,
  UserRound,
} from 'lucide-react';
import { format, parseISO, subDays } from 'date-fns';
import { currentStreak, isRecentFirst, todayKey, weekRange } from './lib/dates';
import { hasSupabaseConfig, supabase } from './lib/supabase';
import type { CheckIn, Profile, View } from './types';

const SELECTED_PROFILE_KEY = 'workout-challenge-selected-profile-id';

type ChallengeStat = {
  profile: Profile;
  dates: string[];
  todayCheckIn: CheckIn | undefined;
  weeklyCount: number;
  streak: number;
};

type Tab = {
  id: View;
  label: string;
  icon: typeof Home;
};

const tabs: Tab[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { id: 'history', label: 'History', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(() => {
    return localStorage.getItem(SELECTED_PROFILE_KEY) ?? '';
  });
  const [view, setView] = useState<View>('home');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
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
      const nextProfiles = (profilesResult.data ?? []) as Profile[];
      setProfiles(nextProfiles);
      setCheckIns((checkInsResult.data ?? []) as CheckIn[]);

      const savedProfileId = localStorage.getItem(SELECTED_PROFILE_KEY);
      if (!savedProfileId && nextProfiles.length > 0) {
        setSelectedProfileId('');
      }
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

  const checkInsByProfile = useMemo(() => {
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
  const recentCheckIns = [...checkIns].sort((a, b) => isRecentFirst(a.check_in_date, b.check_in_date)).slice(0, 24);

  const pickProfile = (profileId: string) => {
    setSelectedProfileId(profileId);
    localStorage.setItem(SELECTED_PROFILE_KEY, profileId);
    setView('home');
  };

  const checkInToday = async () => {
    if (!supabase || !selectedProfile || hasCheckedInToday) return;

    setIsSaving(true);
    setError(null);
    const result = await supabase
      .from('check_ins')
      .insert({ profile_id: selectedProfile.id, check_in_date: today })
      .select()
      .single();

    if (result.error) {
      setError(result.error.message);
    } else {
      setCheckIns((existing) => [result.data as CheckIn, ...existing]);
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

  const updateGoal = async (profileId: string, weeklyGoal: number) => {
    if (!supabase) return;

    setError(null);
    setProfiles((existing) =>
      existing.map((profile) =>
        profile.id === profileId ? { ...profile, weekly_goal: weeklyGoal } : profile,
      ),
    );

    const result = await supabase.from('profiles').update({ weekly_goal: weeklyGoal }).eq('id', profileId);
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
      <main className="grid min-h-screen place-items-center bg-orange-50 px-6 text-slate-900">
        <div className="flex items-center gap-3 rounded-full bg-white px-5 py-3 shadow-soft">
          <Loader2 className="h-5 w-5 animate-spin text-rose-500" />
          <span className="font-semibold">Loading the challenge...</span>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-orange-50 pb-28 text-slate-950">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-6 pt-5">
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-rose-500">Private challenge</p>
            <h1 className="mt-1 text-3xl font-black leading-tight">Workout Wins</h1>
          </div>
          <button
            className="grid h-11 w-11 place-items-center rounded-full bg-white text-slate-800 shadow-sm"
            onClick={loadData}
            aria-label="Refresh challenge data"
          >
            <RotateCcw className="h-5 w-5" />
          </button>
        </header>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
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
                onCheckIn={checkInToday}
                onUndo={undoToday}
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
                onGoalChange={updateGoal}
                onPickProfile={pickProfile}
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
    <main className="grid min-h-screen place-items-center bg-orange-50 px-5 text-slate-950">
      <section className="w-full max-w-md rounded-lg bg-white p-5 shadow-soft">
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
      <div className="rounded-lg bg-white p-5 shadow-soft">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-700">
          <UserRound className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-2xl font-black">Pick your profile</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Three friends. One scoreboard. Choose your lane.</p>
        <div className="mt-5 grid gap-3">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-left font-bold text-slate-950 transition hover:border-rose-300 hover:bg-rose-50"
              onClick={() => onPick(profile.id)}
            >
              {profile.name}
              <span className="rounded-full bg-white px-3 py-1 text-xs text-slate-500 shadow-sm">
                Goal {profile.weekly_goal}/week
              </span>
            </button>
          ))}
          {profiles.length === 0 ? (
            <p className="rounded-lg bg-yellow-50 px-4 py-3 text-sm font-medium text-yellow-900">
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
  onCheckIn,
  onUndo,
  selectedProfile,
  selectedStats,
  today,
}: {
  checkInsByProfile: ChallengeStat[];
  hasCheckedInToday: boolean;
  isSaving: boolean;
  onCheckIn: () => void;
  onUndo: () => void;
  selectedProfile: Profile;
  selectedStats: ChallengeStat | undefined;
  today: string;
}) {
  return (
    <div className="grid gap-4">
      <section className="rounded-lg bg-slate-950 p-5 text-white shadow-soft">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-orange-200">{format(parseISO(today), 'EEEE, MMM d')}</p>
            <h2 className="mt-1 text-2xl font-black">You&apos;re up, {selectedProfile.name}</h2>
          </div>
          <div className="grid h-14 w-14 place-items-center rounded-full bg-rose-500">
            <Flame className="h-7 w-7" />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Metric label="Streak" value={`${selectedStats?.streak ?? 0}`} detail="days" />
          <Metric
            label="This week"
            value={`${selectedStats?.weeklyCount ?? 0}/${selectedProfile.weekly_goal}`}
            detail="goal"
          />
        </div>
        <button
          className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-orange-200 px-4 py-4 text-base font-black text-slate-950 transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-70"
          onClick={hasCheckedInToday ? onUndo : onCheckIn}
          disabled={isSaving}
        >
          {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : hasCheckedInToday ? <RotateCcw className="h-5 w-5" /> : <Check className="h-5 w-5" />}
          {hasCheckedInToday ? 'Undo today' : 'Check in today'}
        </button>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-black">Today&apos;s board</h2>
        <div className="grid gap-3">
          {checkInsByProfile.map(({ profile, todayCheckIn, streak, weeklyCount }) => (
            <div key={profile.id} className="flex items-center justify-between rounded-lg bg-white p-4 shadow-sm">
              <div>
                <p className="font-black">{profile.name}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {streak} day streak · {weeklyCount}/{profile.weekly_goal} this week
                </p>
              </div>
              <div
                className={`grid h-11 w-11 place-items-center rounded-full ${
                  todayCheckIn ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
                }`}
                aria-label={todayCheckIn ? 'Checked in today' : 'Not checked in today'}
              >
                <Check className="h-5 w-5" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function LeaderboardView({
  leaderboard,
  week,
}: {
  leaderboard: ChallengeStat[];
  week: ReturnType<typeof weekRange>;
}) {
  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-2xl font-black">Weekly leaderboard</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">
          {format(parseISO(week.start), 'MMM d')} - {format(parseISO(week.end), 'MMM d')}
        </p>
      </div>
      <div className="grid gap-3">
        {leaderboard.map(({ profile, weeklyCount, streak }, index) => (
          <div key={profile.id} className="flex items-center gap-3 rounded-lg bg-white p-4 shadow-sm">
            <div
              className={`grid h-12 w-12 shrink-0 place-items-center rounded-full font-black ${
                index === 0 ? 'bg-yellow-100 text-yellow-800' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {index === 0 ? <Medal className="h-6 w-6" /> : index + 1}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-black">{profile.name}</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-rose-500"
                  style={{ width: `${Math.min((weeklyCount / Math.max(profile.weekly_goal, 1)) * 100, 100)}%` }}
                />
              </div>
            </div>
            <div className="text-right">
              <p className="font-black">{weeklyCount}</p>
              <p className="text-xs font-semibold text-slate-500">{streak} streak</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HistoryView({ checkIns, profiles }: { checkIns: CheckIn[]; profiles: Profile[] }) {
  const profileName = (profileId: string) => profiles.find((profile) => profile.id === profileId)?.name ?? 'Friend';

  return (
    <section>
      <h2 className="text-2xl font-black">Recent check-ins</h2>
      <div className="mt-4 grid gap-3">
        {checkIns.map((checkIn) => (
          <div key={checkIn.id} className="flex items-center justify-between rounded-lg bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                <Check className="h-5 w-5" />
              </div>
              <div>
                <p className="font-black">{profileName(checkIn.profile_id)}</p>
                <p className="text-sm text-slate-500">{format(parseISO(checkIn.check_in_date), 'EEEE, MMM d')}</p>
              </div>
            </div>
            <CalendarDays className="h-5 w-5 text-slate-300" />
          </div>
        ))}
        {checkIns.length === 0 ? (
          <p className="rounded-lg bg-white p-4 text-sm font-medium text-slate-500 shadow-sm">
            No check-ins yet. The first tap gets the scoreboard moving.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function SettingsView({
  profiles,
  selectedProfileId,
  onGoalChange,
  onPickProfile,
}: {
  profiles: Profile[];
  selectedProfileId: string;
  onGoalChange: (profileId: string, weeklyGoal: number) => void;
  onPickProfile: (profileId: string) => void;
}) {
  return (
    <section className="grid gap-5">
      <div>
        <h2 className="text-2xl font-black">Settings</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">Tune the goal or swap profiles.</p>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-black uppercase tracking-[0.14em] text-slate-500">Weekly goals</h3>
        <div className="grid gap-3">
          {profiles.map((profile) => (
            <div key={profile.id} className="rounded-lg bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="font-black">{profile.name}</p>
                <p className="text-sm font-bold text-rose-600">{profile.weekly_goal} days/week</p>
              </div>
              <input
                className="mt-4 w-full accent-rose-500"
                type="range"
                min="1"
                max="7"
                step="1"
                value={profile.weekly_goal}
                onChange={(event) => onGoalChange(profile.id, Number(event.target.value))}
                aria-label={`${profile.name} weekly goal`}
              />
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-black uppercase tracking-[0.14em] text-slate-500">Profile</h3>
        <div className="grid grid-cols-3 gap-2">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              className={`min-h-12 rounded-lg px-2 text-sm font-black ${
                profile.id === selectedProfileId ? 'bg-slate-950 text-white' : 'bg-white text-slate-700 shadow-sm'
              }`}
              onClick={() => onPickProfile(profile.id)}
            >
              {profile.name}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg bg-white/10 p-3">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-100">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
      <p className="text-sm font-medium text-orange-100">{detail}</p>
    </div>
  );
}

function BottomNav({ currentView, onChange }: { currentView: View; onChange: (view: View) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 px-3 pb-4 pt-2 backdrop-blur">
      <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentView === tab.id;
          return (
            <button
              key={tab.id}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-black ${
                isActive ? 'bg-orange-100 text-rose-600' : 'text-slate-500'
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

export default App;
