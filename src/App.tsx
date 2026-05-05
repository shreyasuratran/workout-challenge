import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  ExternalLink,
  Gift,
  History,
  Home,
  Image,
  Loader2,
  RotateCcw,
  Settings,
  Sparkles,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isWeekend,
  parseISO,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from 'date-fns';
import { currentStreak, isRecentFirst, todayKey, weekRange } from './lib/dates';
import { hasSupabaseConfig, supabase } from './lib/supabase';
import type { CheckIn, Profile, View } from './types';

const SELECTED_PROFILE_KEY = 'workout-challenge-selected-profile-id';
const NOTE_LIMIT = 120;
const VACATION_NOTE_LIMIT = 100;
const PROOF_BUCKET = 'workout-proofs';
const PROOF_EXPIRATION_HOURS = 48;

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

type ProofPhoto = {
  path: string;
  url: string;
  uploadedAt: string;
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
  }
> = {
  strawberry: {
    shell: 'from-pink-200 via-rose-50 to-fuchsia-100',
    soft: 'bg-pink-100',
    strong: 'bg-pink-500',
    text: 'text-pink-700',
    ring: 'ring-pink-200',
    bar: 'bg-pink-500',
  },
  peach: {
    shell: 'from-orange-100 via-amber-50 to-pink-100',
    soft: 'bg-orange-100',
    strong: 'bg-orange-400',
    text: 'text-orange-700',
    ring: 'ring-orange-200',
    bar: 'bg-orange-400',
  },
  lavender: {
    shell: 'from-violet-100 via-fuchsia-50 to-rose-50',
    soft: 'bg-violet-100',
    strong: 'bg-violet-500',
    text: 'text-violet-700',
    ring: 'ring-violet-200',
    bar: 'bg-violet-500',
  },
  mint: {
    shell: 'from-emerald-100 via-teal-50 to-lime-50',
    soft: 'bg-emerald-100',
    strong: 'bg-emerald-500',
    text: 'text-emerald-700',
    ring: 'ring-emerald-200',
    bar: 'bg-emerald-500',
  },
  sky: {
    shell: 'from-sky-100 via-cyan-50 to-indigo-50',
    soft: 'bg-sky-100',
    strong: 'bg-sky-500',
    text: 'text-sky-700',
    ring: 'ring-sky-200',
    bar: 'bg-sky-500',
  },
  lemon: {
    shell: 'from-yellow-100 via-amber-50 to-lime-50',
    soft: 'bg-yellow-100',
    strong: 'bg-yellow-400',
    text: 'text-yellow-800',
    ring: 'ring-yellow-200',
    bar: 'bg-yellow-400',
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

const isVacationActive = (profile: Profile, dateKey = todayKey()) => {
  if (!profile.vacation_mode) return false;
  return !profile.vacation_until || profile.vacation_until >= dateKey;
};

const isVacationDay = (profile: Profile, dateKey: string) => {
  if (!isVacationActive(profile)) return false;
  if (dateKey < todayKey()) return false;
  return !profile.vacation_until || dateKey <= profile.vacation_until;
};

const vacationStatusText = (profile: Profile) => {
  if (!isVacationActive(profile)) return null;
  const until = profile.vacation_until ? ` until ${format(parseISO(profile.vacation_until), 'MMM d')}` : '';
  return `${profile.name} is on vacation${until} 🌴`;
};

const readExifOrientation = async (file: File) => {
  try {
    const view = new DataView(await file.arrayBuffer());
    if (view.getUint16(0, false) !== 0xffd8) return 1;

    let offset = 2;
    while (offset < view.byteLength) {
      const marker = view.getUint16(offset, false);
      offset += 2;

      if (marker === 0xffda || marker === 0xffd9) break;
      const segmentLength = view.getUint16(offset, false);
      if (segmentLength < 2) break;

      if (marker === 0xffe1) {
        const segmentStart = offset + 2;
        const hasExifHeader =
          view.getUint32(segmentStart, false) === 0x45786966 && view.getUint16(segmentStart + 4, false) === 0;

        if (hasExifHeader) {
          const tiffOffset = segmentStart + 6;
          const byteOrder = view.getUint16(tiffOffset, false);
          const littleEndian = byteOrder === 0x4949;
          const firstIfdOffset = view.getUint32(tiffOffset + 4, littleEndian);
          const entriesOffset = tiffOffset + firstIfdOffset;
          const entries = view.getUint16(entriesOffset, littleEndian);

          for (let index = 0; index < entries; index += 1) {
            const entryOffset = entriesOffset + 2 + index * 12;
            const tag = view.getUint16(entryOffset, littleEndian);
            if (tag === 0x0112) {
              return view.getUint16(entryOffset + 8, littleEndian);
            }
          }
        }
      }

      offset += segmentLength;
    }
  } catch {
    return 1;
  }

  return 1;
};

const loadImageSource = async (file: File) => {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'none' });
    } catch {
      // Fall back to HTMLImageElement below for older mobile browsers.
    }
  }

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = document.createElement('img');
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not read image'));
    };

    image.src = objectUrl;
  });
};

const applyExifTransform = (
  context: CanvasRenderingContext2D,
  orientation: number,
  canvasWidth: number,
  canvasHeight: number,
  shouldFlipHorizontally: boolean,
) => {
  switch (orientation) {
    case 2:
      context.transform(-1, 0, 0, 1, canvasWidth, 0);
      break;
    case 3:
      context.transform(-1, 0, 0, -1, canvasWidth, canvasHeight);
      break;
    case 4:
      context.transform(1, 0, 0, -1, 0, canvasHeight);
      break;
    case 5:
      context.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      context.transform(0, 1, -1, 0, canvasWidth, 0);
      break;
    case 7:
      context.transform(0, -1, -1, 0, canvasWidth, canvasHeight);
      break;
    case 8:
      context.transform(0, -1, 1, 0, 0, canvasHeight);
      break;
    default:
      break;
  }

  if (shouldFlipHorizontally) {
    context.translate(canvasWidth, 0);
    context.scale(-1, 1);
  }
};

const compressProofImage = async (file: File, shouldFlipHorizontally = false) => {
  const orientation = await readExifOrientation(file);
  const image = await loadImageSource(file);
  const rawWidth = image.width;
  const rawHeight = image.height;
  const swapsDimensions = orientation >= 5 && orientation <= 8;
  const orientedWidth = swapsDimensions ? rawHeight : rawWidth;
  const orientedHeight = swapsDimensions ? rawWidth : rawHeight;
  const scale = Math.min(1200 / orientedWidth, 1);
  const canvasWidth = Math.round(orientedWidth * scale);
  const canvasHeight = Math.round(orientedHeight * scale);
  const drawWidth = Math.round(rawWidth * scale);
  const drawHeight = Math.round(rawHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext('2d');

  if (!context) {
    if ('close' in image) image.close();
    throw new Error('Could not prepare image');
  }

  applyExifTransform(context, orientation, canvasWidth, canvasHeight, shouldFlipHorizontally);
  context.drawImage(image, 0, 0, drawWidth, drawHeight);
  if ('close' in image) image.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Could not compress image'));
        }
      },
      'image/jpeg',
      0.78,
    );
  });
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
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [processedProofBlob, setProcessedProofBlob] = useState<Blob | null>(null);
  const [isProofFlipped, setIsProofFlipped] = useState(false);
  const [isProcessingProof, setIsProcessingProof] = useState(false);
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const activeTheme = getTheme(selectedProfile);
  const today = todayKey();
  const week = weekRange();

  const cleanupOldProofPhotos = useCallback(async (loadedCheckIns: CheckIn[]) => {
    if (!supabase) return;

    const cutoff = Date.now() - PROOF_EXPIRATION_HOURS * 60 * 60 * 1000;
    const expiredPhotos = loadedCheckIns.filter((checkIn) => {
      if (!checkIn.photo_path || !checkIn.photo_uploaded_at) return false;
      return new Date(checkIn.photo_uploaded_at).getTime() < cutoff;
    });

    if (expiredPhotos.length === 0) return;

    try {
      const paths = expiredPhotos.map((checkIn) => checkIn.photo_path!).filter(Boolean);
      await supabase.storage.from(PROOF_BUCKET).remove(paths);
      await supabase
        .from('check_ins')
        .update({ photo_url: null, photo_path: null, photo_uploaded_at: null })
        .in('id', expiredPhotos.map((checkIn) => checkIn.id));

      setCheckIns((existing) =>
        existing.map((checkIn) =>
          expiredPhotos.some((expired) => expired.id === checkIn.id)
            ? { ...checkIn, photo_url: null, photo_path: null, photo_uploaded_at: null }
            : checkIn,
        ),
      );
    } catch {
      // Best-effort cleanup only. Storage policy limits should never block the app.
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const since = subDays(new Date(), 370);
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
      const nextCheckIns = (checkInsResult.data ?? []) as CheckIn[];
      setProfiles((profilesResult.data ?? []) as Profile[]);
      setCheckIns(nextCheckIns);
      void cleanupOldProofPhotos(nextCheckIns);
    }

    setIsLoading(false);
  }, [cleanupOldProofPhotos]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (selectedProfileId) {
      localStorage.setItem(SELECTED_PROFILE_KEY, selectedProfileId);
    }
  }, [selectedProfileId]);

  useEffect(() => {
    return () => {
      if (proofPreviewUrl) {
        URL.revokeObjectURL(proofPreviewUrl);
      }
    };
  }, [proofPreviewUrl]);

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

  const setProcessedProofPreview = (blob: Blob | null) => {
    if (proofPreviewUrl) {
      URL.revokeObjectURL(proofPreviewUrl);
    }

    setProcessedProofBlob(blob);
    setProofPreviewUrl(blob ? URL.createObjectURL(blob) : null);
  };

  const processProofFile = async (file: File, shouldFlipHorizontally: boolean) => {
    setIsProcessingProof(true);
    try {
      const blob = await compressProofImage(file, shouldFlipHorizontally);
      setProcessedProofPreview(blob);
    } catch {
      setError('Could not prepare that photo. You can still check in without it.');
      setProcessedProofPreview(null);
    } finally {
      setIsProcessingProof(false);
    }
  };

  const selectProofFile = (file: File | null) => {
    setProofFile(file);
    setIsProofFlipped(false);

    if (!file) {
      setProcessedProofPreview(null);
      return;
    }

    void processProofFile(file, false);
  };

  const flipProofPhoto = () => {
    if (!proofFile || isProcessingProof) return;

    const nextFlip = !isProofFlipped;
    setIsProofFlipped(nextFlip);
    void processProofFile(proofFile, nextFlip);
  };

  const uploadProofPhoto = async (profileId: string): Promise<ProofPhoto | null> => {
    if (!supabase || !processedProofBlob) return null;

    try {
      const timestamp = Date.now();
      const path = `proofs/${profileId}/${today}-${timestamp}.jpg`;
      const uploadResult = await supabase.storage.from(PROOF_BUCKET).upload(path, processedProofBlob, {
        cacheControl: '3600',
        contentType: 'image/jpeg',
        upsert: false,
      });

      if (uploadResult.error) {
        return null;
      }

      const publicUrl = supabase.storage.from(PROOF_BUCKET).getPublicUrl(path).data.publicUrl;
      return {
        path,
        url: publicUrl,
        uploadedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  };

  const checkInToday = async () => {
    if (!supabase || !selectedProfile || hasCheckedInToday) return;

    setIsSaving(true);
    setError(null);
    const proofPhoto = await uploadProofPhoto(selectedProfile.id);
    const trimmedNote = noteText.trim().slice(0, NOTE_LIMIT);
    const payload: {
      profile_id: string;
      check_in_date: string;
      note_text?: string;
      photo_url?: string;
      photo_path?: string;
      photo_uploaded_at?: string;
    } = {
      profile_id: selectedProfile.id,
      check_in_date: today,
    };
    if (trimmedNote) {
      payload.note_text = trimmedNote;
    }
    if (proofPhoto) {
      payload.photo_url = proofPhoto.url;
      payload.photo_path = proofPhoto.path;
      payload.photo_uploaded_at = proofPhoto.uploadedAt;
    }

    const result = await supabase.from('check_ins').insert(payload).select().single();

    if (result.error) {
      setError(result.error.message);
      if (proofPhoto) {
        void supabase.storage.from(PROOF_BUCKET).remove([proofPhoto.path]);
      }
    } else {
      setCheckIns((existing) => [result.data as CheckIn, ...existing]);
      setNoteText('');
      selectProofFile(null);
      setIsProofFlipped(false);
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

  const removeTodayPhoto = async () => {
    if (!supabase || !selectedStats?.todayCheckIn?.photo_path) return;

    const checkIn = selectedStats.todayCheckIn;
    const photoPath = checkIn.photo_path;
    if (!photoPath) return;
    setError(null);

    try {
      await supabase.storage.from(PROOF_BUCKET).remove([photoPath]);
      const result = await supabase
        .from('check_ins')
        .update({ photo_url: null, photo_path: null, photo_uploaded_at: null })
        .eq('id', checkIn.id);

      if (result.error) {
        setError(result.error.message);
        return;
      }

      setCheckIns((existing) =>
        existing.map((item) =>
          item.id === checkIn.id ? { ...item, photo_url: null, photo_path: null, photo_uploaded_at: null } : item,
        ),
      );
    } catch {
      setError('Could not remove the photo. Try again in a moment.');
    }
  };

  const updateProfile = async (
    profileId: string,
    updates: Partial<
      Pick<Profile, 'weekly_goal' | 'avatar_emoji' | 'theme_color' | 'vacation_mode' | 'vacation_note' | 'vacation_until'>
    >,
  ) => {
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
                isProcessingProof={isProcessingProof}
                isProofFlipped={isProofFlipped}
                noteText={noteText}
                onCheckIn={checkInToday}
                onFlipProofPhoto={flipProofPhoto}
                onNoteChange={setNoteText}
                onPhotoPreview={setPhotoPreviewUrl}
                onProofFileChange={selectProofFile}
                onRemoveTodayPhoto={removeTodayPhoto}
                onUndo={undoToday}
                proofPreviewUrl={proofPreviewUrl}
                recentCheckIns={recentCheckIns.slice(0, 10)}
                selectedProfile={selectedProfile}
                selectedStats={selectedStats}
                today={today}
              />
            ) : null}
            {view === 'leaderboard' ? <LeaderboardView leaderboard={leaderboard} week={week} /> : null}
            {view === 'history' ? (
              <HistoryView
                checkIns={checkIns}
                onPhotoPreview={setPhotoPreviewUrl}
                profiles={profiles}
                selectedProfile={selectedProfile}
              />
            ) : null}
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
      {photoPreviewUrl ? <PhotoPreviewModal photoUrl={photoPreviewUrl} onClose={() => setPhotoPreviewUrl(null)} /> : null}
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
      <div className="rounded-[2rem] border border-white/80 bg-white/90 p-5 shadow-soft ring-1 ring-pink-100/60">
        <div className="flex -space-x-3">
          {profiles.map((profile) => (
            <AvatarBubble key={profile.id} profile={profile} size="md" />
          ))}
        </div>
        <h2 className="mt-5 text-2xl font-black">Pick your player</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Three friends. One soft little scoreboard.</p>
        <div className="mt-5 grid gap-3">
          {profiles.map((profile) => {
            const theme = getTheme(profile);
            const vacation = vacationStatusText(profile);
            return (
              <button
                key={profile.id}
                className={`flex items-center gap-3 rounded-3xl border border-white bg-white px-4 py-4 text-left font-bold text-slate-950 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft ${theme.ring}`}
                onClick={() => onPick(profile.id)}
              >
                <AvatarBubble profile={profile} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block">{profile.name}</span>
                  {vacation ? <span className="mt-1 block text-xs font-bold text-slate-400">{vacation}</span> : null}
                </span>
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
  isProcessingProof,
  isProofFlipped,
  noteText,
  onCheckIn,
  onFlipProofPhoto,
  onNoteChange,
  onPhotoPreview,
  onProofFileChange,
  onRemoveTodayPhoto,
  onUndo,
  proofPreviewUrl,
  recentCheckIns,
  selectedProfile,
  selectedStats,
  today,
}: {
  checkInsByProfile: ChallengeStat[];
  hasCheckedInToday: boolean;
  isSaving: boolean;
  isProcessingProof: boolean;
  isProofFlipped: boolean;
  noteText: string;
  onCheckIn: () => void;
  onFlipProofPhoto: () => void;
  onNoteChange: (note: string) => void;
  onPhotoPreview: (photoUrl: string) => void;
  onProofFileChange: (file: File | null) => void;
  onRemoveTodayPhoto: () => void;
  onUndo: () => void;
  proofPreviewUrl: string | null;
  recentCheckIns: CheckIn[];
  selectedProfile: Profile;
  selectedStats: ChallengeStat | undefined;
  today: string;
}) {
  const theme = getTheme(selectedProfile);
  const badges = getBadges(selectedStats);

  return (
    <div className="grid gap-5">
      <section className="relative overflow-hidden rounded-[1.75rem] border border-white/80 bg-white/95 p-4 text-slate-950 shadow-soft ring-1 ring-white">
        <div className={`absolute inset-x-4 top-0 h-1.5 rounded-b-full ${theme.strong}`} />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className={`text-xs font-black uppercase tracking-[0.14em] ${theme.text}`}>
              {format(parseISO(today), 'EEE, MMM d')}
            </p>
            <h2 className="mt-1 text-2xl font-black leading-tight">Daily Mission</h2>
            <p className="mt-1 text-sm font-semibold leading-5 text-slate-600">{dailyChallengeFor(today)}</p>
            {vacationStatusText(selectedProfile) ? (
              <p className={`mt-2 inline-flex rounded-full ${theme.soft} px-3 py-1 text-xs font-black ${theme.text}`}>
                {vacationStatusText(selectedProfile)}
              </p>
            ) : null}
          </div>
          <div className="shrink-0 rounded-3xl border border-white bg-white p-1 shadow-sm">
            <AvatarBubble profile={selectedProfile} size="md" />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <MissionStat label="Streak" value={`${selectedStats?.streak ?? 0}`} detail="days" />
          <MissionStat label="Week" value={`${selectedStats?.weeklyCount ?? 0}/${selectedProfile.weekly_goal}`} detail="goal" />
        </div>

        {!hasCheckedInToday ? (
          <div className="mt-3 grid gap-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase tracking-[0.14em] text-slate-400">Add a quick note?</span>
              <input
                className="min-h-11 w-full rounded-2xl border border-pink-100 bg-pink-50/70 px-4 text-sm font-semibold text-slate-700 placeholder:text-slate-400 outline-none focus:border-pink-200"
                maxLength={NOTE_LIMIT}
                onChange={(event) => onNoteChange(event.target.value.slice(0, NOTE_LIMIT))}
                placeholder="quick walk, yoga, lift..."
                value={noteText}
              />
              <span className="mt-1 block text-right text-[11px] font-semibold text-slate-400">{noteText.length}/{NOTE_LIMIT}</span>
            </label>
            <div className="rounded-2xl border border-pink-100 bg-pink-50/70 p-2.5">
              <p className="text-xs font-bold text-slate-500">Proof photos are optional and may disappear after about 48 hours.</p>
              <p className="mt-1 text-xs font-semibold text-slate-400">Preview shows the exact processed image that will upload.</p>
              {proofPreviewUrl ? (
                <div className="mt-3 flex items-center gap-3">
                  <button
                    className="h-20 w-20 overflow-hidden rounded-2xl border border-white"
                    onClick={() => onPhotoPreview(proofPreviewUrl)}
                    type="button"
                  >
                    <img alt="Selected proof preview" className="h-full w-full object-cover" src={proofPreviewUrl} />
                  </button>
                  <div className="grid min-w-0 flex-1 gap-2">
                    <button
                      className="flex min-h-10 items-center justify-center gap-2 rounded-2xl bg-white px-3 text-sm font-black text-slate-700 disabled:opacity-60"
                      disabled={isProcessingProof}
                      onClick={onFlipProofPhoto}
                      type="button"
                    >
                      <RotateCcw className="h-4 w-4" />
                      {isProofFlipped ? 'Undo flip' : 'Flip photo'}
                    </button>
                    <button
                      className="flex min-h-10 items-center justify-center gap-2 rounded-2xl bg-white px-3 text-sm font-black text-slate-700"
                      onClick={() => onProofFileChange(null)}
                      type="button"
                    >
                      <X className="h-4 w-4" />
                      Remove
                    </button>
                  </div>
                </div>
              ) : isProcessingProof ? (
                <div className="mt-2 flex min-h-10 items-center justify-center gap-2 rounded-2xl bg-white px-3 text-sm font-black text-slate-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Preparing preview
                </div>
              ) : (
                <label className="mt-2 flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-white px-3 text-sm font-black text-slate-950 shadow-sm">
                  <Image className="h-4 w-4" />
                  Add proof photo
                  <input
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(event) => onProofFileChange(event.target.files?.[0] ?? null)}
                    type="file"
                  />
                </label>
              )}
            </div>
          </div>
        ) : null}

        <button
          className={`mt-3 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl ${
            hasCheckedInToday ? 'bg-slate-950 text-white' : `${theme.strong} text-white`
          } px-4 py-3.5 text-base font-black shadow-sm transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70`}
          onClick={hasCheckedInToday ? onUndo : onCheckIn}
          disabled={isSaving || isProcessingProof}
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
              onPhotoPreview={onPhotoPreview}
              profile={profile}
              streak={streak}
              todayCheckIn={todayCheckIn}
              weeklyCount={weeklyCount}
            />
          ))}
        </div>
      </section>

      <BadgeShelf badges={badges} />
      {selectedStats?.todayCheckIn?.photo_url ? (
        <button
          className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/80 bg-white/90 px-4 text-sm font-black text-slate-700 shadow-sm"
          onClick={onRemoveTodayPhoto}
        >
          <Trash2 className="h-4 w-4" />
          Remove today&apos;s proof photo
        </button>
      ) : null}
      <RecentWins
        checkIns={recentCheckIns}
        onPhotoPreview={onPhotoPreview}
        profiles={checkInsByProfile.map((entry) => entry.profile)}
      />
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
          const goalText = `${weeklyCount}/${profile.weekly_goal} goal`;
          return (
            <div key={profile.id} className="overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/90 p-3.5 shadow-sm ring-1 ring-white">
              <div className="flex items-center gap-3">
                <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl font-black ${index === 0 ? 'bg-yellow-100 text-yellow-800' : 'bg-slate-100 text-slate-600'}`}>
                  {index === 0 ? <Crown className="h-6 w-6" /> : index + 1}
                </div>
                <AvatarBubble profile={profile} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate font-black">{profile.name}</p>
                    {index === 0 ? (
                      <span className={`shrink-0 rounded-full ${theme.soft} px-2 py-0.5 text-[10px] font-black ${theme.text}`}>
                        lead
                      </span>
                    ) : null}
                  </div>
                  {vacationStatusText(profile) ? (
                    <p className="mt-0.5 truncate text-xs font-bold text-slate-400">{vacationStatusText(profile)}</p>
                  ) : null}
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${theme.bar}`} style={{ width: `${Math.min((weeklyCount / Math.max(profile.weekly_goal, 1)) * 100, 100)}%` }} />
                  </div>
                  <p className={`mt-1 truncate text-[11px] font-black ${theme.text}`}>{goalText}</p>
                </div>
                <div className="w-14 shrink-0 text-right">
                  <p className="text-2xl font-black leading-none tabular-nums">{weeklyCount}</p>
                  <p className="mt-1 whitespace-nowrap text-[11px] font-semibold text-slate-500">{streak} streak</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HistoryView({
  checkIns,
  onPhotoPreview,
  profiles,
  selectedProfile,
}: {
  checkIns: CheckIn[];
  onPhotoPreview: (photoUrl: string) => void;
  profiles: Profile[];
  selectedProfile: Profile;
}) {
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const theme = getTheme(selectedProfile);
  const selectedUserCheckIns = useMemo(() => {
    return checkIns.filter((checkIn) => checkIn.profile_id === selectedProfile.id);
  }, [checkIns, selectedProfile.id]);
  const recentActivity = useMemo(() => {
    return [...checkIns]
      .sort((a, b) => {
        const dateOrder = isRecentFirst(a.check_in_date, b.check_in_date);
        if (dateOrder !== 0) return dateOrder;
        return b.created_at.localeCompare(a.created_at);
      })
      .slice(0, 24);
  }, [checkIns]);
  const selectedCheckIn = selectedUserCheckIns.find((checkIn) => isSameDay(parseISO(checkIn.check_in_date), selectedDate));
  const selectedVacation = isVacationDay(selectedProfile, format(selectedDate, 'yyyy-MM-dd'));
  const monthDays = useMemo(() => {
    return eachDayOfInterval({
      start: startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 0 }),
      end: endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 0 }),
    });
  }, [visibleMonth]);

  return (
    <section className="grid gap-5">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">Recent Wins</p>
        <h2 className="text-3xl font-black">Workout history</h2>
      </div>

      {vacationStatusText(selectedProfile) ? (
        <div className="rounded-[1.5rem] border border-white/80 bg-white/90 px-4 py-3 text-sm font-black text-emerald-700 shadow-sm">
          {vacationStatusText(selectedProfile)}
        </div>
      ) : null}

      <div className="rounded-[2rem] border border-white/80 bg-white/90 p-4 shadow-sm ring-1 ring-white">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AvatarBubble profile={selectedProfile} size="sm" />
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Calendar</p>
              <h3 className="text-xl font-black">{format(visibleMonth, 'MMMM yyyy')}</h3>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-50 text-slate-600 shadow-sm"
              onClick={() => setVisibleMonth((month) => subMonths(month, 1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-50 text-slate-600 shadow-sm"
              onClick={() => setVisibleMonth((month) => addMonths(month, 1))}
              aria-label="Next month"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-7 gap-1 text-center text-[11px] font-black uppercase tracking-[0.08em] text-slate-400">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
            <span key={`${day}-${index}`}>{day}</span>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-7 gap-1">
          {monthDays.map((day) => {
            const dayKey = format(day, 'yyyy-MM-dd');
            const checkIn = selectedUserCheckIns.find((item) => item.check_in_date === dayKey);
            const hasNote = Boolean(checkIn?.note_text?.trim());
            const vacationDay = isVacationDay(selectedProfile, dayKey);
            const isCurrentMonth = isSameMonth(day, visibleMonth);
            const isSelected = isSameDay(day, selectedDate);
            return (
              <button
                key={dayKey}
                className={`relative grid aspect-square min-h-10 place-items-center rounded-2xl text-sm font-black transition ${
                  isSelected ? 'bg-slate-950 text-white shadow-sm' : isCurrentMonth ? 'bg-white text-slate-700' : 'bg-transparent text-slate-300'
                }`}
                onClick={() => setSelectedDate(day)}
                aria-label={`${format(day, 'MMMM d')}${checkIn ? ', checked in' : ', no check-in'}`}
              >
                <span
                  className={`grid h-8 w-8 place-items-center rounded-full ${
                    checkIn && !isSelected ? `${theme.strong} text-white` : ''
                  }`}
                >
                  {checkIn ? <Check className="h-4 w-4" /> : format(day, 'd')}
                </span>
                {hasNote ? (
                  <span
                    className={`absolute bottom-1 h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-white' : theme.strong}`}
                    aria-hidden="true"
                  />
                ) : null}
                {vacationDay && !checkIn ? (
                  <span className="absolute bottom-0.5 text-[10px] leading-none" aria-hidden="true">
                    🌴
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className={`mt-4 rounded-[1.5rem] ${theme.soft} p-4`}>
          <p className={`text-xs font-black uppercase tracking-[0.14em] ${theme.text}`}>
            {format(selectedDate, 'EEEE, MMM d')}
          </p>
          <p className="mt-1 font-black text-slate-950">
            {selectedCheckIn
              ? `${selectedProfile.name} logged a workout.`
              : selectedVacation
                ? `${selectedProfile.name} is on vacation 🌴`
                : 'No workout logged for this day.'}
          </p>
          {selectedCheckIn?.note_text ? (
            <p className="mt-2 rounded-2xl bg-white/80 px-3 py-2 text-sm font-semibold text-slate-600">
              “{selectedCheckIn.note_text}”
            </p>
          ) : null}
          {selectedCheckIn?.photo_url ? (
            <button
              className="mt-3 h-24 w-24 overflow-hidden rounded-2xl border border-white/80 shadow-sm"
              onClick={() => onPhotoPreview(selectedCheckIn.photo_url!)}
            >
              <img alt="Workout proof" className="h-full w-full object-cover" src={selectedCheckIn.photo_url} />
            </button>
          ) : null}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-lg font-black">Latest activity</h3>
        <div className="grid gap-3">
        {recentActivity.map((checkIn) => {
          const profile = profiles.find((item) => item.id === checkIn.profile_id);
          return (
            <div key={checkIn.id} className="rounded-[1.5rem] border border-white/80 bg-white/90 p-4 shadow-sm ring-1 ring-white">
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
              {checkIn.photo_url ? (
                <button
                  className="mt-3 h-20 w-20 overflow-hidden rounded-2xl border border-white shadow-sm"
                  onClick={() => onPhotoPreview(checkIn.photo_url!)}
                >
                  <img alt="Workout proof" className="h-full w-full object-cover" src={checkIn.photo_url} />
                </button>
              ) : null}
            </div>
          );
        })}
        {recentActivity.length === 0 ? (
          <p className="rounded-2xl bg-white p-4 text-sm font-medium text-slate-500 shadow-sm">
            No wins yet. The first tap gets the scoreboard moving.
          </p>
        ) : null}
        </div>
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
  onUpdateProfile: (
    profileId: string,
    updates: Partial<
      Pick<Profile, 'weekly_goal' | 'avatar_emoji' | 'theme_color' | 'vacation_mode' | 'vacation_note' | 'vacation_until'>
    >,
  ) => void;
}) {
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
  const selectedTheme = getTheme(selectedProfile);

  return (
    <section className="grid gap-5">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">Settings</p>
        <h2 className="text-3xl font-black">Customize your corner</h2>
      </div>

      {selectedProfile ? (
        <div className="rounded-[2rem] border border-white/80 bg-white/90 p-4 shadow-sm ring-1 ring-pink-100/60">
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

      {selectedProfile ? (
        <div className="rounded-[2rem] border border-white/80 bg-white/90 p-4 shadow-sm ring-1 ring-white">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">Vacation mode</p>
              <p className="mt-1 text-sm font-semibold text-slate-500">Let friends know you are away.</p>
            </div>
            <button
              className={`relative h-8 w-14 rounded-full p-1 transition ${
                selectedProfile.vacation_mode ? selectedTheme.strong : 'bg-slate-200'
              }`}
              onClick={() =>
                onUpdateProfile(selectedProfile.id, {
                  vacation_mode: !selectedProfile.vacation_mode,
                  vacation_note: selectedProfile.vacation_note?.slice(0, VACATION_NOTE_LIMIT) ?? null,
                  vacation_until:
                    !selectedProfile.vacation_mode &&
                    selectedProfile.vacation_until &&
                    selectedProfile.vacation_until < todayKey()
                      ? null
                      : selectedProfile.vacation_until,
                })
              }
              aria-label="Toggle vacation mode"
              aria-pressed={Boolean(selectedProfile.vacation_mode)}
            >
              <span
                className={`block h-6 w-6 rounded-full bg-white shadow-sm transition ${
                  selectedProfile.vacation_mode ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {selectedProfile.vacation_mode ? (
            <div className="mt-4 grid gap-3">
              <label>
                <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-400">Note</span>
                <input
                  className="min-h-12 w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 text-sm font-semibold text-slate-700 outline-none focus:border-pink-200"
                  maxLength={VACATION_NOTE_LIMIT}
                  onChange={(event) =>
                    onUpdateProfile(selectedProfile.id, {
                      vacation_note: event.target.value.slice(0, VACATION_NOTE_LIMIT) || null,
                    })
                  }
                  placeholder="Traveling this week"
                  value={selectedProfile.vacation_note ?? ''}
                />
                <span className="mt-1 block text-right text-[11px] font-semibold text-slate-400">
                  {(selectedProfile.vacation_note ?? '').length}/{VACATION_NOTE_LIMIT}
                </span>
              </label>
              <label>
                <span className="mb-2 block text-xs font-black uppercase tracking-[0.14em] text-slate-400">Until</span>
                <input
                  className="min-h-12 w-full rounded-2xl border border-slate-100 bg-slate-50 px-4 text-sm font-semibold text-slate-700 outline-none focus:border-pink-200"
                  onChange={(event) =>
                    onUpdateProfile(selectedProfile.id, {
                      vacation_until: event.target.value || null,
                    })
                  }
                  type="date"
                  value={selectedProfile.vacation_until ?? ''}
                />
              </label>
              {vacationStatusText(selectedProfile) ? (
                <p className={`rounded-2xl ${selectedTheme.soft} px-3 py-2 text-sm font-black ${selectedTheme.text}`}>
                  {vacationStatusText(selectedProfile)}
                </p>
              ) : (
                <p className="rounded-2xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">
                  Vacation mode is on, but the end date has passed.
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <h3 className="mb-3 text-sm font-black uppercase tracking-[0.14em] text-slate-500">Weekly goals</h3>
        <div className="grid gap-3">
          {profiles.map((profile) => {
            const theme = getTheme(profile);
            return (
              <div key={profile.id} className="rounded-[1.5rem] border border-white/80 bg-white/90 p-4 shadow-sm ring-1 ring-white">
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
  onPhotoPreview,
  profile,
  streak,
  todayCheckIn,
  weeklyCount,
}: {
  onPhotoPreview: (photoUrl: string) => void;
  profile: Profile;
  streak: number;
  todayCheckIn: CheckIn | undefined;
  weeklyCount: number;
}) {
  const theme = getTheme(profile);
  const vacation = vacationStatusText(profile);

  return (
    <div className="flex items-center justify-between rounded-[1.5rem] border border-white/80 bg-white/90 p-4 shadow-sm ring-1 ring-white">
      <div className="flex min-w-0 items-center gap-3">
        <AvatarBubble profile={profile} size="sm" />
        <div className="min-w-0">
          <p className="font-black">{profile.name}</p>
          {vacation ? (
            <p className="mt-1 text-sm font-bold text-emerald-600">{vacation}</p>
          ) : (
            <p className="mt-1 text-sm text-slate-500">
              {streak} day streak · {weeklyCount}/{profile.weekly_goal} this week
            </p>
          )}
        </div>
      </div>
      {todayCheckIn?.photo_url ? (
        <button
          className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-white shadow-sm"
          onClick={() => onPhotoPreview(todayCheckIn.photo_url!)}
          aria-label="Open proof photo"
        >
          <img alt="Workout proof" className="h-full w-full object-cover" src={todayCheckIn.photo_url} />
        </button>
      ) : (
        <div
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${
            todayCheckIn ? `${theme.soft} ${theme.text}` : 'bg-slate-100 text-slate-400'
          }`}
          aria-label={todayCheckIn ? 'Checked in today' : 'Not checked in today'}
        >
          {todayCheckIn ? <Check className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </div>
      )}
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
            className={`relative overflow-hidden rounded-[1.4rem] border border-white/80 p-3 shadow-sm ring-1 ring-white ${
              badge.unlocked ? 'bg-white/95 text-slate-950' : 'bg-white/55 text-slate-400'
            }`}
          >
            <div className="absolute right-3 top-2 rotate-6 text-xs font-black text-slate-200">★</div>
            <div className={`mb-2 grid h-10 w-10 place-items-center rounded-2xl border border-white text-lg shadow-sm ${badge.unlocked ? 'bg-pink-100' : 'bg-slate-100 grayscale'}`}>
              {badge.icon}
            </div>
            <p className="text-sm font-black">{badge.label}</p>
            <p className="mt-1 text-xs font-bold">{badge.unlocked ? 'Collected' : 'Locked'}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentWins({
  checkIns,
  onPhotoPreview,
  profiles,
}: {
  checkIns: CheckIn[];
  onPhotoPreview: (photoUrl: string) => void;
  profiles: Profile[];
}) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-black">Recent Wins</h2>
      <div className="grid gap-3">
        {checkIns.map((checkIn) => {
          const profile = profiles.find((item) => item.id === checkIn.profile_id);
          const note = checkIn.note_text?.trim();
          return (
            <div key={checkIn.id} className="flex items-start gap-3 rounded-[1.5rem] border border-white/80 bg-white/90 p-3 shadow-sm ring-1 ring-white">
              {profile ? <AvatarBubble profile={profile} size="xs" /> : null}
              <p className="min-w-0 flex-1 text-sm font-semibold leading-6 text-slate-600">
                {note
                  ? `${profile?.name ?? 'Friend'} added: “${note}”.`
                  : `${profile?.name ?? 'Friend'} ${describeDay(checkIn.check_in_date) === 'yesterday' ? 'logged a win yesterday' : `checked in ${describeDay(checkIn.check_in_date)}`}.`}
              </p>
              {checkIn.photo_url ? (
                <button
                  className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-white shadow-sm"
                  onClick={() => onPhotoPreview(checkIn.photo_url!)}
                  aria-label="Open proof photo"
                >
                  <img alt="Workout proof" className="h-full w-full object-cover" src={checkIn.photo_url} />
                </button>
              ) : null}
            </div>
          );
        })}
        {checkIns.length === 0 ? (
          <p className="rounded-2xl border border-white/80 bg-white/90 p-4 text-sm font-semibold text-slate-500 shadow-sm">
            Wins will land here after the first check-in.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function MissionStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-pink-100 bg-pink-50/70 p-3">
      <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-black leading-none text-slate-950">{value}</p>
      <p className="mt-0.5 text-xs font-bold text-slate-500">{detail}</p>
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

function PhotoPreviewModal({ photoUrl, onClose }: { photoUrl: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-slate-950/70 px-4 backdrop-blur-sm">
      <section className="w-full max-w-md rounded-[2rem] bg-white p-3 shadow-soft">
        <div className="flex items-center justify-between gap-3 px-2 pb-3 pt-1">
          <div>
            <p className="text-sm font-black text-slate-950">Proof photo</p>
            <p className="text-xs font-semibold text-slate-500">Open full photo to save it.</p>
          </div>
          <button
            className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-100 text-slate-600"
            onClick={onClose}
            aria-label="Close photo preview"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <img alt="Workout proof preview" className="max-h-[70vh] w-full rounded-[1.5rem] object-contain" src={photoUrl} />
        <a
          className="mt-3 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-black text-white"
          href={photoUrl}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink className="h-4 w-4" />
          Open full photo
        </a>
      </section>
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
