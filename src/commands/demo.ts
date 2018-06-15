import chalk from 'chalk';
import { prompt, Question } from 'inquirer';
import { Argv } from 'yargs';

export const command = ['demo', 'd'];
export const description = '🎬 Run a demo of craft';

export const builder = (yargs: Argv) =>
  yargs.option('m', {
    alias: 'message',
    description: 'Message to print when done',
    type: 'string',
  });

/** Command line options. */
interface DemoOptions {
  message?: string;
}

/** Inquirer answers. */
interface DemoAnswers {
  message?: string;
  ready: boolean;
}

export const handler = async (argv: DemoOptions) => {
  const questions: Array<Question<DemoAnswers>> = [
    {
      message: 'What should I print in the end?',
      name: 'message',
      type: 'input',
      when: () => !argv.message,
    },
    {
      message: 'Ready?',
      name: 'ready',
      type: 'confirm',
    },
  ];

  const answers = await prompt(questions);
  console.info();

  if (!answers.ready) {
    console.info(chalk.yellow('👀 maybe next time...'));
    return;
  }

  const message = answers.message || argv.message;
  if (!message) {
    throw new Error('You need to enter a message');
  }

  console.info('🎉  %s! %s', chalk.green('woooho'), chalk.dim(message));
};
