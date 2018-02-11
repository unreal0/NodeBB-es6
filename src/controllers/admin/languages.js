

var async = require('async');

var languages = require('../../languages');
var meta = require('../../meta');

var languagesController = module.exports;

languagesController.get = (req, res, next) => {
	async.waterfall([
		(next) => {
			languages.list(next);
		},
		(languages) => {
			languages.forEach((language) => {
				language.selected = language.code === (meta.config.defaultLang || 'en-GB');
			});

			res.render('admin/general/languages', {
				languages: languages,
				autoDetectLang: parseInt(meta.config.autoDetectLang, 10) === 1,
			});
		},
	], next);
};

