var async = require('async');

var db = require('../../database');

module.exports = {
	name: 'Changing ip blacklist storage to object',
	timestamp: Date.UTC(2017, 8, 7),
	method: (callback) => {
		var rules;
		async.waterfall([
			(next) => {
				db.get('ip-blacklist-rules', next);
			},
			(_rules, next) => {
				rules = _rules;
				db.delete('ip-blacklist-rules', rules ? next : callback);
			},
			(next) => {
				db.setObject('ip-blacklist-rules', { rules: rules }, next);
			},
		], callback);
	},
};
