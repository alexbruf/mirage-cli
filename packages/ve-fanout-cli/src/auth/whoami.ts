import { getValidAccessToken, loadCredentials } from './tokens.ts';

interface UserInfo {
	sub?: string;
	email?: string;
	name?: string;
	preferred_username?: string;
}

export async function whoami(): Promise<number> {
	const creds = loadCredentials();
	const token = await getValidAccessToken();
	if (!creds || !token) {
		process.stderr.write('Not logged in. Run `ve-fanout login` first.\n');
		return 1;
	}
	const res = await fetch(`${creds.authServer}/oauth/userinfo`, {
		headers: { authorization: `Bearer ${token}` },
	});
	if (!res.ok) {
		process.stderr.write(`Userinfo failed: ${res.status} ${await res.text()}\n`);
		return 1;
	}
	const info = (await res.json()) as UserInfo;
	console.log(
		JSON.stringify(
			{
				userId: info.sub,
				email: info.email,
				name: info.name,
				username: info.preferred_username,
				apiUrl: creds.apiUrl,
				activeOrgId: creds.activeOrgId ?? null,
				expiresAt: new Date(creds.expiresAt).toISOString(),
			},
			null,
			2,
		),
	);
	return 0;
}
