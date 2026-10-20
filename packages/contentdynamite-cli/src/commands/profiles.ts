import { basename, extname } from 'node:path';
import type { Command } from 'commander';
import type { ApiClient } from '../client';
import type { Cli } from '../context';
import { readBytes } from '../files';
import { documentOutput, downloadDocument, integer } from '../helpers';
import { err, out } from '../output';
import { ICP_SECTIONS, type CompanyProfileResponseDto } from '../wire';

interface ProfileOptions {
	name?: string;
	website?: string;
	sitemap?: string;
	writingGuide?: string;
}

const stripScheme = (url: string) => url.replace(/^https?:\/\//i, '');

const flagOf = (field: string) => `--${field.replaceAll('_', '-')}`;

const optionKeyOf = (field: string) => field.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

const sectionLabel = (field: string) => `${field.charAt(0).toUpperCase()}${field.slice(1).replaceAll('_', ' ')} section`;

async function findProfile(client: ApiClient, profileId: number): Promise<CompanyProfileResponseDto> {
	const profile = (await client.get<CompanyProfileResponseDto[]>('company-profile/')).find((item) => item.id === profileId);
	if (!profile) throw new Error(`profile ${profileId} not found, run \`ve-dynamite profiles list\``);
	return profile;
}

function parseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

export function parseIcp(icp: string): Record<string, unknown> | null {
	let sections: unknown;
	try {
		sections = JSON.parse(icp);
	} catch {
		return null;
	}
	if (sections === null || typeof sections !== 'object' || Array.isArray(sections)) return null;
	return Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, typeof value === 'string' ? parseJson(value) : value]));
}

function profileBody(options: ProfileOptions): Record<string, string> {
	const body: Record<string, string> = {};
	if (options.name) body.name = options.name;
	if (options.website) body.website_url = stripScheme(options.website);
	if (options.sitemap) body.sitemap_url = stripScheme(options.sitemap);
	if (options.writingGuide) body.writing_guide = options.writingGuide;
	return body;
}

export function registerProfiles(program: Command, cli: Cli): void {
	const profiles = program.command('profiles').description('Manage company profiles');

	profiles
		.command('create')
		.description('Create a company profile (also starts async ICP generation, which costs money)')
		.requiredOption('--name <name>', 'Company name')
		.requiredOption('--website <host>', 'Company website, bare host like example.com (scheme is stripped)')
		.option('--sitemap <host>', 'Sitemap URL, bare host form')
		.option('--writing-guide <text>', 'Writing style guide')
		.action(async (options: ProfileOptions) => {
			const res = await cli.client().post('company-profile/create', profileBody(options));
			cli.billed(1);
			err('ICP generation started in the background, check progress with `ve-dynamite icp show <id>`');
			out(res);
		});

	profiles
		.command('list')
		.description('List all company profiles')
		.action(async () => out(await cli.client().get('company-profile/')));

	profiles
		.command('get')
		.description('Show one company profile')
		.argument('<ID>', 'Company profile id', integer)
		.action(async (profileId: number) => out(await findProfile(cli.client(), profileId)));

	profiles
		.command('update')
		.description('Update profile fields (only the flags you pass are changed)')
		.argument('<ID>', 'Company profile id', integer)
		.option('--name <name>', 'New company name')
		.option('--website <host>', 'New website, bare host form (scheme is stripped)')
		.option('--sitemap <host>', 'New sitemap URL')
		.option('--writing-guide <text>', 'New writing style guide')
		.action(async (profileId: number, options: ProfileOptions) => {
			const body = profileBody(options);
			if (Object.keys(body).length === 0) throw new Error('nothing to update, pass at least one of --name, --website, --sitemap, --writing-guide');
			out(await cli.client().put(`company-profile/${profileId}`, body));
		});

	profiles
		.command('delete')
		.description('Delete a profile and everything under it (articles, ICP, categories)')
		.argument('<ID>', 'Company profile id', integer)
		.option('--yes', 'Confirm the deletion')
		.action(async (profileId: number, options: { yes?: boolean }) => {
			if (!options.yes) throw new Error('deleting a profile also deletes its articles, re-run with --yes to confirm');
			out(await cli.client().delete(`company-profile/${profileId}`));
		});

	const icp = program.command('icp').description("Manage a profile's ICP (ideal customer profile)");

	icp
		.command('show')
		.description('Show the ICP, or its generation status when not ready')
		.argument('<PROFILE-ID>', 'Company profile id', integer)
		.action(async (profileId: number) => {
			const profile = await findProfile(cli.client(), profileId);
			const parsed = parseIcp(profile.icp);
			out(parsed && Object.keys(parsed).length > 0 ? parsed : { status: profile.icp });
		});

	documentOutput(
		icp
			.command('export')
			.description("Download a profile's ICP as a document (docx imports straight into Google Docs)")
			.argument('<PROFILE-ID>', 'Company profile id', integer)
			.option('--format <format>', 'docx (opens in Google Docs) or md', 'docx'),
		cli,
	).action(async (profileId: number, options: { format: string; output?: string }) => {
		const target = await downloadDocument(cli, `company-profile/${profileId}/icp/export`, options.format, options.output, `company-${profileId}-icp`);
		err(`exported the ICP for profile ${profileId} to ${target}`);
	});

	icp
		.command('regenerate')
		.description('Regenerate the ICP from the website (async, costs money)')
		.argument('<PROFILE-ID>', 'Company profile id', integer)
		.action(async (profileId: number) => {
			const res = await cli.client().post(`company-profile/${profileId}/regenerate-icp`);
			cli.billed(1);
			err('ICP regeneration started in the background, check progress with `ve-dynamite icp show <id>`');
			out(res);
		});

	const updateIcp = icp
		.command('update')
		.description('Edit ICP sections directly (only the flags you pass are changed)')
		.argument('<PROFILE-ID>', 'Company profile id', integer);
	for (const section of ICP_SECTIONS) updateIcp.option(`${flagOf(section)} <text>`, sectionLabel(section));
	updateIcp.action(async (profileId: number, options: Record<string, string | undefined>) => {
		const body = Object.fromEntries(ICP_SECTIONS.flatMap((section) => (options[optionKeyOf(section)] === undefined ? [] : [[section, options[optionKeyOf(section)]]])));
		if (Object.keys(body).length === 0) throw new Error(`nothing to update, pass at least one of ${ICP_SECTIONS.map(flagOf).join(', ')}`);
		out(await cli.client().put(`company-profile/${profileId}/icp`, body));
	});

	const categories = program.command('categories').description("Manage a profile's article categories");

	categories
		.command('list')
		.description('List categories with article counts')
		.argument('<PROFILE-ID>', 'Company profile id', integer)
		.action(async (profileId: number) => out(await cli.client().get(`company-profile/${profileId}/categories`)));

	categories
		.command('add')
		.description('Add one or more categories (no commas in names)')
		.argument('<PROFILE-ID>', 'Company profile id', integer)
		.argument('<NAMES...>', 'Category names')
		.action(async (profileId: number, names: string[]) => out(await cli.client().post(`company-profile/${profileId}/categories`, { categories: names })));

	const design = program
		.command('design-system')
		.description("The client's own design system: the colours, type and photography every page for them renders in");

	design
		.command('show')
		.description('Show the stored design system: its tokens and every image with the alt written for it')
		.argument('<PROFILE-ID>', 'Company profile id', integer)
		.action(async (profileId: number) => out(await cli.client().get(`company-profile/${profileId}/design-system`)));

	design
		.command('set')
		.description('Upload a design system zip and read it (private storage, one mapping call, one vision call per image)')
		.argument('<PROFILE-ID>', 'Company profile id', integer)
		.argument('<ZIP>', "The design system zip the client's designer exported")
		.action(async (profileId: number, zipPath: string) => {
			if (extname(zipPath).toLowerCase() !== '.zip') throw new Error('a design system is uploaded as a zip archive');
			const zip = new Blob([readBytes(zipPath)], { type: 'application/zip' });
			err('Reading the zip: publishing its fonts and images, mapping its tokens and describing each image. This takes a moment and spends a little.');
			const res = await cli.client().postForm(`company-profile/${profileId}/design-system`, zip, basename(zipPath));
			cli.billed(1);
			out(res);
		});

	design
		.command('rescan')
		.description('Re-read the stored zip, for when the token mapping or an image description was wrong')
		.argument('<PROFILE-ID>', 'Company profile id', integer)
		.action(async (profileId: number) => {
			const res = await cli.client().post(`company-profile/${profileId}/design-system/rescan`);
			cli.billed(1);
			out(res);
		});

	design
		.command('clear')
		.description("Remove the design system. Later pages fall back to the brand kit scraped from the client's site")
		.argument('<PROFILE-ID>', 'Company profile id', integer)
		.action(async (profileId: number) => out(await cli.client().delete(`company-profile/${profileId}/design-system`)));
}
