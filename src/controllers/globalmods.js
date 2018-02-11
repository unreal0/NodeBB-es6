

var async = require('async');

var user = require('../user');
var adminBlacklistController = require('./admin/blacklist');

var globalModsController = module.exports;

globalModsController.ipBlacklist = (req, res, next) => {
	async.waterfall([
		(next) => {
			user.isAdminOrGlobalMod(req.uid, next);
		},
		(isAdminOrGlobalMod, next) => {
			if (!isAdminOrGlobalMod) {
				return next();
			}
			adminBlacklistController.get(req, res, next);
		},
	], next);
};
