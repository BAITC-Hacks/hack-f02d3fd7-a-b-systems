export type Role = 'ADMIN' | 'HR' | 'EMPLOYEE';
export type AuthUser = {
  id: string; username: string; email: string; full_name: string;
  role: Role; employee_id: string | null; is_active: boolean;
};

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const body = await response.json();
  if (response.status === 401 && url !== '/api/auth/login') window.dispatchEvent(new Event('careerquest:unauthorized'));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body as T;
}
