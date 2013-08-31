window.TagCloud = { };

//module for getting tag counts
window.TagCloud.create = function(tweets) {
  var tagCloud = { };
  var result = [ ];

  _.each(tweets, function(d) {
    _.each(d.tags.split(' '), function(t) {
      if(t != "") {
        if(!tagCloud[t]) tagCloud[t] = 0;

        tagCloud[t] += 1;
      }
    });
  });

  for(var tag in tagCloud) {
    result.push({
      tag: tag,
      count: tagCloud[tag],
      important: tag.match(/!/) //tags that contain an "!" are considered important
    });
  }

  return result;
};

//important tweets at the top, the rest follow based on count
window.TagCloud.sort = function(tag) {
  if(tag.important) return -999999;
  return tag.count * -1;
}
