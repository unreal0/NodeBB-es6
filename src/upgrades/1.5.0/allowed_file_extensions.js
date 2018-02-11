var db = require('../../database');

module.exports = {
	name: 'Set default allowed file extensions',
	timestamp: Date.UTC(2017, 3, 14),
	method: (callback) => {
		db.getObjectField('config', 'allowedFileExtensions', (err, value) => {
			if (err || value) {
				return callback(err);
			}
			db.setObjectField('config', 'allowedFileExtensions', 'png,jpg,bmp', callback);
		});
	},
};
