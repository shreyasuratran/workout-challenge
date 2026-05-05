export type ProfileName = 'Shreya' | 'Aditi' | 'Thaanvi';

export type Profile = {
  id: string;
  name: ProfileName;
  weekly_goal: number;
  created_at: string;
};

export type CheckIn = {
  id: string;
  profile_id: string;
  check_in_date: string;
  created_at: string;
};

export type View = 'home' | 'leaderboard' | 'history' | 'settings';
