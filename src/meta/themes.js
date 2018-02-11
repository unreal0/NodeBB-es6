var nconf = require('nconf');
var winston = require('winston');
var fs = require('fs');
var path = require('path');
var async = require('async');

var file = require('../file');
var db = require('../database');
var Meta = require('../meta');
var events = require('../events');

var Themes = module.exports;

Themes.get = (callback) => {
	var themePath = nconf.get('themes_path');
	if (typeof themePath !== 'string') {
		return callback(null, []);
	}

	async.waterfall([
		(next) => {
			fs.readdir(themePath, next);
		},
		(files, next) => {
			async.filter(files, (file, next) => {
				fs.stat(path.join(themePath, file), (err, fileStat) => {
					if (err) {
						if (err.code === 'ENOENT') {
							return next(null, false);
						}
						return next(err);
					}

					next(null, (fileStat.isDirectory() && file.slice(0, 13) === 'nodebb-theme-'));
				});
			}, next);
		},
		(themes, next) => {
			async.map(themes, (theme, next) => {
				var config = path.join(themePath, theme, 'theme.json');

				fs.readFile(config, 'utf8', (err, file) => {
					if (err) {
						if (err.code === 'ENOENT') {
							return next(null, null);
						}
						return next(err);
					}
					try {
						var configObj = JSON.parse(file);

						// Minor adjustments for API output
						configObj.type = 'local';
						if (configObj.screenshot) {
							configObj.screenshot_url = nconf.get('relative_path') + '/css/previews/' + configObj.id;
						} else {
							configObj.screenshot_url = nconf.get('relative_path') + '/assets/images/themes/default.png';
						}
						next(null, configObj);
					} catch (err) {
						winston.error('[themes] Unable to parse theme.json ' + theme);
						next(null, null);
					}
				});
			}, next);
		},
		(themes, next) => {
			themes = themes.filter(Boolean);
			next(null, themes);
		},
	], callback);
};

Themes.set = (data, callback) => {
	var themeData = {
		'theme:type': data.type,
		'theme:id': data.id,
		'theme:staticDir': '',
		'theme:templates': '',
		'theme:src': '',
	};

	switch (data.type) {
	case 'local':
		async.waterfall([
			async.apply(Meta.configs.get, 'theme:id'),
			(current, next) => {
				async.series([
					async.apply(db.sortedSetRemove, 'plugins:active', current),
					async.apply(db.sortedSetAdd, 'plugins:active', 0, data.id),
				], (err) => {
					next(err);
				});
			},
			(next) => {
				fs.readFile(path.join(nconf.get('themes_path'), data.id, 'theme.json'), 'utf8', (err, config) => {
					if (!err) {
						config = JSON.parse(config);
						next(null, config);
					} else {
						next(err);
					}
				});
			},
			(config, next) => {
				themeData['theme:staticDir'] = config.staticDir ? config.staticDir : '';
				themeData['theme:templates'] = config.templates ? config.templates : '';
				themeData['theme:src'] = '';

				Meta.configs.setMultiple(themeData, next);

				// Re-set the themes path (for when NodeBB is reloaded)
				Themes.setPath(config);
			},
			(next) => {
				events.log({
					type: 'theme-set',
					uid: parseInt(data.uid, 10) || 0,
					ip: data.ip || '127.0.0.1',
					text: data.id,
				}, next);
			},
		], callback);

		Meta.reloadRequired = true;
		break;

	case 'bootswatch':
		Meta.configs.setMultiple({
			'theme:src': data.src,
			bootswatchSkin: data.id.toLowerCase(),
		}, callback);
		break;
	}
};

Themes.setupPaths = (callback) => {
	async.waterfall([
		(next) => {
			async.parallel({
				themesData: Themes.get,
				currentThemeId: (next) => {
					db.getObjectField('config', 'theme:id', next);
				},
			}, next);
		},
		(data, next) => {
			var themeId = data.currentThemeId || 'nodebb-theme-persona';

			var themeObj = data.themesData.filter(themeObj => themeObj.id === themeId)[0];

			if (process.env.NODE_ENV === 'development') {
				winston.info('[themes] Using theme ' + themeId);
			}

			if (!themeObj) {
				return callback(new Error('[[error:theme-not-found]]'));
			}

			Themes.setPath(themeObj);
			next();
		},
	], callback);
};

Themes.setPath = (themeObj) => {
	// Theme's templates path
	var themePath = nconf.get('base_templates_path');
	var fallback = path.join(nconf.get('themes_path'), themeObj.id, 'templates');

	if (themeObj.templates) {
		themePath = path.join(nconf.get('themes_path'), themeObj.id, themeObj.templates);
	} else if (file.existsSync(fallback)) {
		themePath = fallback;
	}

	nconf.set('theme_templates_path', themePath);
	nconf.set('theme_config', path.join(nconf.get('themes_path'), themeObj.id, 'theme.json'));
};
