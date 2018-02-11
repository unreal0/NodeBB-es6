

var async = require('async');
var nconf = require('nconf');

var packageInstall = require('./package-install');
var upgrade = require('../upgrade');
var build = require('../meta/build');
var db = require('../database');
var meta = require('../meta');
var upgradePlugins = require('./upgrade-plugins').upgradePlugins;

var steps = {
	package: {
		message: 'Updating package.json file with defaults...',
		handler: (next) => {
			packageInstall.updatePackageFile();
			packageInstall.preserveExtraneousPlugins();
			process.stdout.write('  OK\n'.green);
			next();
		},
	},
	install: {
		message: 'Bringing base dependencies up to date...',
		handler: (next) => {
			process.stdout.write('  started\n'.green);
			packageInstall.installAll();
			next();
		},
	},
	plugins: {
		message: 'Checking installed plugins for updates...',
		handler: (next) => {
			async.series([
				db.init,
				upgradePlugins,
			], next);
		},
	},
	schema: {
		message: 'Updating NodeBB data store schema...',
		handler: (next) => {
			async.series([
				db.init,
				upgrade.run,
			], next);
		},
	},
	build: {
		message: 'Rebuilding assets...',
		handler: build.buildAll,
	},
};

function runSteps(tasks) {
	tasks = tasks.map((key, i) => (next) => {
		process.stdout.write('\n' + ((i + 1) + '. ').bold + steps[key].message.yellow);
		return steps[key].handler((err) => {
			if (err) { return next(err); }
			next();
		});
	});

	async.series(tasks, (err) => {
		if (err) {
			console.error('Error occurred during upgrade');
			throw err;
		}

		var message = 'NodeBB Upgrade Complete!';
		// some consoles will return undefined/zero columns, so just use 2 spaces in upgrade script if we can't get our column count
		var columns = process.stdout.columns;
		var spaces = columns ? new Array(Math.floor(columns / 2) - (message.length / 2) + 1).join(' ') : '  ';

		console.log('\n\n' + spaces + message.green.bold + '\n'.reset);

		process.exit();
	});
}

function runUpgrade(upgrades, options) {
	console.log('\nUpdating NodeBB...'.cyan);
	options = options || {};
	// disable mongo timeouts during upgrade
	nconf.set('mongo:options:socketTimeoutMS', 0);

	if (upgrades === true) {
		var tasks = Object.keys(steps);
		if (options.package || options.install ||
				options.plugins || options.schema || options.build) {
			tasks = tasks.filter(key => options[key]);
		}
		runSteps(tasks);
		return;
	}

	async.series([
		db.init,
		meta.configs.init,
		async.apply(upgrade.runParticular, upgrades),
	], (err) => {
		if (err) {
			throw err;
		}

		process.exit(0);
	});
}

exports.upgrade = runUpgrade;
