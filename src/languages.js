var fs = require('fs');
var path = require('path');
var async = require('async');

var Languages = module.exports;
var languagesPath = path.join(__dirname, '../build/public/language');

Languages.get = (language, namespace, callback) => {
	fs.readFile(path.join(languagesPath, language, namespace + '.json'), { encoding: 'utf-8' }, (err, data) => {
		if (err) {
			return callback(err);
		}

		try {
			data = JSON.parse(data) || {};
		} catch (e) {
			return callback(e);
		}

		callback(null, data);
	});
};

var codeCache = null;
Languages.listCodes = (callback) => {
	if (codeCache && codeCache.length) {
		return callback(null, codeCache);
	}

	fs.readFile(path.join(languagesPath, 'metadata.json'), 'utf8', (err, file) => {
		if (err && err.code === 'ENOENT') {
			return callback(null, []);
		}
		if (err) {
			return callback(err);
		}

		var parsed;
		try {
			parsed = JSON.parse(file);
		} catch (e) {
			return callback(e);
		}

		var langs = parsed.languages;
		codeCache = langs;
		callback(null, langs);
	});
};

var listCache = null;
Languages.list = (callback) => {
	if (listCache && listCache.length) {
		return callback(null, listCache);
	}

	Languages.listCodes((err, codes) => {
		if (err) {
			return callback(err);
		}

		async.map(codes, (folder, next) => {
			var configPath = path.join(languagesPath, folder, 'language.json');

			fs.readFile(configPath, 'utf8', (err, file) => {
				if (err && err.code === 'ENOENT') {
					return next();
				}
				if (err) {
					return next(err);
				}
				try {
					var lang = JSON.parse(file);
					next(null, lang);
				} catch (e) {
					next(e);
				}
			});
		}, (err, languages) => {
			if (err) {
				return callback(err);
			}

			// filter out invalid ones
			languages = languages.filter(lang => lang && lang.code && lang.name && lang.dir);

			listCache = languages;
			callback(null, languages);
		});
	});
};
