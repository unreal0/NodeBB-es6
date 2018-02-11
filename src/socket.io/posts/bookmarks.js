var helpers = require('./helpers');

module.exports = (SocketPosts) => {
	SocketPosts.bookmark = (socket, data, callback) => {
		helpers.postCommand(socket, 'bookmark', 'bookmarked', '', data, callback);
	};

	SocketPosts.unbookmark = (socket, data, callback) => {
		helpers.postCommand(socket, 'unbookmark', 'bookmarked', '', data, callback);
	};
};
