var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var winston = require('winston');
var async = require('async');
var path = require('path');
var fs = require('fs');
var nconf = require('nconf');
var _ = require('lodash');

var plugins = require('../plugins');
var file = require('../file');

var viewsPath = nconf.get('views_dir');

var Templates = module.exports;

function processImports(paths, templatePath, source, callback) {
	var regex = /<!-- IMPORT (.+?) -->/;

	var matches = source.match(regex);

	if (!matches) {
		return callback(null, source);
	}

	var partial = matches[1];
	if (paths[partial] && templatePath !== partial) {
		fs.readFile(paths[partial], 'utf8', (err, partialSource) => {
			if (err) {
				return callback(err);
			}

			source = source.replace(regex, partialSource);
			processImports(paths, templatePath, source, callback);
		});
	} else {
		winston.warn('[meta/templates] Partial not loaded: ' + matches[1]);
		source = source.replace(regex, '');

		processImports(paths, templatePath, source, callback);
	}
}
Templates.processImports = processImports;

function getTemplateDirs(callback) {
	var pluginTemplates = _.values(plugins.pluginsData)
		.filter(pluginData => !pluginData.id.startsWith('nodebb-theme-'))
		.map(pluginData => path.join(__dirname, '../../node_modules/', pluginData.id, pluginData.templates || 'templates'));

	var themeConfig = require(nconf.get('theme_config'));
	var theme = themeConfig.baseTheme;

	var themePath;
	var themeTemplates = [nconf.get('theme_templates_path')];
	while (theme) {
		themePath = path.join(nconf.get('themes_path'), theme);
		themeConfig = require(path.join(themePath, 'theme.json'));

		themeTemplates.push(path.join(themePath, themeConfig.templates || 'templates'));
		theme = themeConfig.baseTheme;
	}

	themeTemplates.push(nconf.get('base_templates_path'));
	themeTemplates = _.uniq(themeTemplates.reverse());

	var coreTemplatesPath = nconf.get('core_templates_path');

	var templateDirs = _.uniq([coreTemplatesPath].concat(themeTemplates, pluginTemplates));

	async.filter(templateDirs, file.exists, callback);
}

function getTemplateFiles(dirs, callback) {
	async.waterfall([
		(cb) => {
			async.map(dirs, (dir, next) => {
				file.walk(dir, (err, files) => {
					if (err) { return next(err); }

					files = files.filter(path => path.endsWith('.tpl')).map(file => ({
						name: path.relative(dir, file).replace(/\\/g, '/'),
						path: file,
					}));
					next(null, files);
				});
			}, cb);
		},
		(buckets, cb) => {
			var dict = {};
			buckets.forEach((files) => {
				files.forEach((file) => {
					dict[file.name] = file.path;
				});
			});

			cb(null, dict);
		},
	], callback);
}

function compile(callback) {
	callback = callback || function () {};

	async.waterfall([
		(next) => {
			rimraf(viewsPath, (err) => { next(err); });
		},
		(next) => {
			mkdirp(viewsPath, (err) => { next(err); });
		},
		getTemplateDirs,
		getTemplateFiles,
		(files, next) => {
			async.each(Object.keys(files), (name, next) => {
				var filePath = files[name];

				async.waterfall([
					(next) => {
						fs.readFile(filePath, 'utf8', next);
					},
					(source, next) => {
						processImports(files, name, source, next);
					},
					(source, next) => {
						mkdirp(path.join(viewsPath, path.dirname(name)), (err) => {
							next(err, source);
						});
					},
					(compiled, next) => {
						fs.writeFile(path.join(viewsPath, name), compiled, next);
					},
				], next);
			}, next);
		},
		(next) => {
			winston.verbose('[meta/templates] Successfully compiled templates.');
			next();
		},
	], callback);
}
Templates.compile = compile;
