export interface SystemStatus {
  database: string;
  redis: string;
  celery: {
    status: string;
    task_id: string;
  } | string;
}

export interface HelloResponse {
  message: string;
  status: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
  bio?: string;
  created_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  member_count?: number;
  created_at: string;
}

export interface Plan {
  id: string;
  name: string;
  slug: string;
  price_cents: number;
  price_dollars: number;
  currency: string;
  interval: "month" | "year";
  features: string[];
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  notification_type: "INFO" | "SUCCESS" | "WARNING" | "ALERT";
  link?: string;
  is_read: boolean;
  created_at: string;
}
