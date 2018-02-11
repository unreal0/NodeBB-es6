var db = require('../../database');

var async = require('async');
var winston = require('winston');

module.exports = {
	name: 'Removing best posts with negative scores',
	timestamp: Date.UTC(2016, 7, 5),
	method: (callback) => {
		var batch = require('../../batch');
		batch.processSortedSet('users:joindate', (ids, next) => {
			async.each(ids, (id, next) => {
				winston.verbose('processing uid ' + id);
				db.sortedSetsRemoveRangeByScore(['uid:' + id + ':posts:votes'], '-inf', 0, next);
			}, next);
		}, {}, callback);
	},
};
