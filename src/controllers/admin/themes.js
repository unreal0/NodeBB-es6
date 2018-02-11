

var path = require('path');
var fs = require('fs');
var async = require('async');

var file = require('../../file');

var themesController = module.exports;

var defaultScreenshotPath = path.join(__dirname, '../../../public/images/themes/default.png');

themesController.get = (req, res, next) => {
	var themeDir = path.join(__dirname, '../../../node_modules', req.params.theme);
	var themeConfigPath = path.join(themeDir, 'theme.json');
	var screenshotPath;
	async.waterfall([
		(next) => {
			file.exists(themeConfigPath, next);
		},
		(exists, next) => {
			if (!exists) {
				return next(Error('invalid-data'));
			}

			fs.readFile(themeConfigPath, 'utf8', next);
		},
		(themeConfig, next) => {
			try {
				themeConfig = JSON.parse(themeConfig);
				next(null, themeConfig.screenshot ? path.join(themeDir, themeConfig.screenshot) : defaultScreenshotPath);
			} catch (e) {
				next(e);
			}
		},
		(_screenshotPath, next) => {
			screenshotPath = _screenshotPath;
			file.exists(screenshotPath, next);
		},
		(exists) => {
			res.sendFile(exists ? screenshotPath : defaultScreenshotPath);
		},
	], next);
};

