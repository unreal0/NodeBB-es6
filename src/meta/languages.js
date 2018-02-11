var path = require('path');
var async = require('async');
var fs = require('fs');
var mkdirp = require('mkdirp');
var rimraf = require('rimraf');
var _ = require('lodash');

var file = require('../file');
var Plugins = require('../plugins');

var buildLanguagesPath = path.join(__dirname, '../../build/public/language');
var coreLanguagesPath = path.join(__dirname, '../../public/language');

function getTranslationMetadata(callback) {
	async.waterfall([
		// generate list of languages and namespaces
		(next) => {
			file.walk(coreLanguagesPath, next);
		},
		(paths, next) => {
			var languages = [];
			var namespaces = [];

			paths.forEach((p) => {
				if (!p.endsWith('.json')) {
					return;
				}

				var rel = path.relative(coreLanguagesPath, p).split(/[/\\]/);
				var language = rel.shift().replace('_', '-').replace('@', '-x-');
				var namespace = rel.join('/').replace(/\.json$/, '');

				if (!language || !namespace) {
					return;
				}

				languages.push(language);
				namespaces.push(namespace);
			});

			next(null, {
				languages: _.union(languages, Plugins.languageData.languages).sort().filter(Boolean),
				namespaces: _.union(namespaces, Plugins.languageData.namespaces).sort().filter(Boolean),
			});
		},

		// save a list of languages to `${buildLanguagesPath}/metadata.json`
		// avoids readdirs later on
		(ref, next) => {
			async.series([
				(next) => {
					mkdirp(buildLanguagesPath, next);
				},
				(next) => {
					fs.writeFile(path.join(buildLanguagesPath, 'metadata.json'), JSON.stringify({
						languages: ref.languages,
						namespaces: ref.namespaces,
					}), next);
				},
			], (err) => {
				next(err, ref);
			});
		},
	], callback);
}

function writeLanguageFile(language, namespace, translations, callback) {
	var dev = global.env === 'development';
	var filePath = path.join(buildLanguagesPath, language, namespace + '.json');

	async.series([
		async.apply(mkdirp, path.dirname(filePath)),
		async.apply(fs.writeFile, filePath, JSON.stringify(translations, null, dev ? 2 : 0)),
	], callback);
}

// for each language and namespace combination,
// run through core and all plugins to generate
// a full translation hash
function buildTranslations(ref, next) {
	var namespaces = ref.namespaces;
	var languages = ref.languages;
	var plugins = _.values(Plugins.pluginsData).filter(plugin => typeof plugin.languages === 'string');

	async.each(namespaces, (namespace, next) => {
		async.each(languages, (lang, next) => {
			var translations = {};

			async.series([
				// core first
				(cb) => {
					fs.readFile(path.join(coreLanguagesPath, lang, namespace + '.json'), 'utf8', (err, file) => {
						if (err) {
							if (err.code === 'ENOENT') {
								return cb();
							}
							return cb(err);
						}

						try {
							Object.assign(translations, JSON.parse(file));
							cb();
						} catch (err) {
							cb(err);
						}
					});
				},
				(cb) => {
					// for each plugin, fallback in this order:
					//  1. correct language string (en-GB)
					//  2. old language string (en_GB)
					//  3. corrected plugin defaultLang (en-US)
					//  4. old plugin defaultLang (en_US)
					async.each(plugins, (pluginData, done) => {
						var pluginLanguages = path.join(__dirname, '../../node_modules/', pluginData.id, pluginData.languages);
						var defaultLang = pluginData.defaultLang || 'en-GB';

						async.eachSeries([
							defaultLang.replace('-', '_').replace('-x-', '@'),
							defaultLang.replace('_', '-').replace('@', '-x-'),
							lang.replace('-', '_').replace('-x-', '@'),
							lang,
						], (language, next) => {
							fs.readFile(path.join(pluginLanguages, language, namespace + '.json'), 'utf8', (err, file) => {
								if (err) {
									if (err.code === 'ENOENT') {
										return next(null, false);
									}
									return next(err);
								}

								try {
									Object.assign(translations, JSON.parse(file));
									next(null, true);
								} catch (err) {
									next(err);
								}
							});
						}, done);
					}, (err) => {
						if (err) {
							return cb(err);
						}

						if (Object.keys(translations).length) {
							writeLanguageFile(lang, namespace, translations, cb);
							return;
						}
						cb();
					});
				},
			], next);
		}, next);
	}, next);
}

exports.build = function buildLanguages(callback) {
	async.waterfall([
		(next) => {
			rimraf(buildLanguagesPath, next);
		},
		getTranslationMetadata,
		buildTranslations,
	], callback);
};
