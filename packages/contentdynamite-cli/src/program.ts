import { Command, CommanderError, Option } from 'commander';
import { registerArticles } from './commands/articles';
import { registerAuth } from './commands/auth';
import { registerBatches } from './commands/batches';
import { registerEvals } from './commands/evals';
import { registerGbp } from './commands/gbp';
import { registerImages, registerUpload } from './commands/images';
import { registerLandingPages } from './commands/landing-pages';
import { registerProfiles } from './commands/profiles';
import { registerArticleRevisions, registerRevisions } from './commands/revisions';
import { registerTokens } from './commands/tokens';
import { registerUsers } from './commands/users';
import { cliFor } from './context';
import type { ProgramOptions } from './options';
import { err, io } from './output';
import { VERSION } from './version';

export function buildProgram(options: ProgramOptions = {}): Command {
	const program = new Command('ve-dynamite')
		.description('Content Dynamite — content pipeline CLI')
		.version(VERSION, '-V, --version', 'Print the version and exit')
		.option('--token <token>', 'Access token override (or set VE_DYNAMITE_TOKEN env)')
		.addOption(new Option('--pretty', 'Has no effect: output is always indented JSON. Kept so older scripts still run').hideHelp());
	if (!options.mount) program.option('--url <url>', 'API base URL (or set VE_DYNAMITE_API_URL env)');
	program
		.exitOverride()
		.configureOutput({ writeOut: (text) => io.stdout(text), writeErr: (text) => io.stderr(text) })
		.showHelpAfterError('(add --help for additional information)');
	const cli = cliFor(program, options);
	registerAuth(program, cli);
	registerTokens(program, cli);
	registerUsers(program, cli);
	registerProfiles(program, cli);
	registerArticleRevisions(registerArticles(program, cli), cli);
	registerRevisions(program, cli);
	registerBatches(program, cli);
	registerGbp(program, cli);
	registerLandingPages(program, cli);
	registerEvals(program, cli);
	registerImages(program, cli);
	registerUpload(program, cli);
	return program;
}

export async function run(argv: string[], options: ProgramOptions = {}): Promise<number> {
	try {
		await buildProgram(options).parseAsync(argv, { from: 'user' });
		return 0;
	} catch (error) {
		if (error instanceof CommanderError) return error.exitCode;
		err(error instanceof Error ? error.message : String(error));
		return 1;
	}
}
