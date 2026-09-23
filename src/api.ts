export type Role = 'ADMIN' | 'HR' | 'EMPLOYEE';
export type BusinessRole = 'COMPANY_EMPLOYEE' | 'HR_SPECIALIST' | 'DEPARTMENT_MANAGER' |
  'CONTACT_CLIENT' | 'CONTACT_OPERATOR' | 'CONTACT_SUPERVISOR';
export type AuthUser = {
  id: string; username: string; email: string; full_name: string;
  role: Role; business_role: BusinessRole; employee_id: string | null; is_active: boolean; has_avatar: boolean;
};

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const body = await response.json();
  if (response.status === 401 && url !== '/api/auth/login') window.dispatchEvent(new Event('careerquest:unauthorized'));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body as T;
}
