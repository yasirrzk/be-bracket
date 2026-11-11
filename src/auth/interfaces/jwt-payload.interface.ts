export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  role: string;
  jti: string;
  iat?: number;
  exp?: number;
}
