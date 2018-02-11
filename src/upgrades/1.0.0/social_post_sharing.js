var db = require('../../database');

var async = require('async');

module.exports = {
	name: 'Social: Post Sharing',
	timestamp: Date.UTC(2016, 1, 25),
	method: (callback) => {
		var social = require('../../social');
		async.parallel([
			(next) => {
				social.setActivePostSharingNetworks(['facebook', 'google', 'twitter'], next);
			},
			(next) => {
				db.deleteObjectField('config', 'disableSocialButtons', next);
			},
		], callback);
	},
};
