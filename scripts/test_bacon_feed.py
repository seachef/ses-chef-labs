import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path
spec = importlib.util.spec_from_file_location('feed', Path(__file__).with_name('bacon-feed.py'))
feed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(feed)

class TelegramParserTests(unittest.TestCase):
    def post(self, text, ident='virtualbacon/99'):
        return f'<div data-post="{ident}"><div class="tgme_widget_message_text">{text}</div><a><time datetime="2026-09-30T10:00:00Z">10:00</time></a></div>'
    def test_self_closing_break_keeps_full_text(self):
        p = feed.parse(self.post('First<br/>Second<br />Third<br>Fourth'))[0]
        self.assertEqual(p['text'], 'First\nSecond\nThird\nFourth')
    def test_nested_markup_entities_and_adjacent_posts(self):
        posts = feed.parse(self.post('One <b>bold</b><br/>Two &amp; <a href="https://example.com">link</a><img src="x"/> end')+self.post('Next', 'vb_trade/100'))
        self.assertEqual(posts[0]['text'], 'One bold\nTwo & link end')
        self.assertEqual(posts[1]['text'], 'Next')
        self.assertEqual(posts[1]['url'], 'https://t.me/vb_trade/100')
    def test_complete_setup_after_break(self):
        p = feed.parse(self.post('Buy BTC/USDT<br/>Entry: 100<br/>Stop: 90<br/>Target 1: 120'))[0]
        self.assertEqual(feed.explicit_setup(p, datetime(2026,9,30,12,tzinfo=timezone.utc))['targets'], [120])
    def test_incomplete_or_old_source_never_becomes_setup(self):
        p = feed.parse(self.post('BTC dip zone 78–84k<br/>Weekly close below 78k invalidates thesis'))[0]
        self.assertIsNone(feed.explicit_setup(p, datetime(2026,9,30,12,tzinfo=timezone.utc)))
        p = feed.parse(self.post('Buy BTC/USDT<br/>Entry: 100<br/>Stop: 90<br/>Target: 120'))[0]
        self.assertIsNone(feed.explicit_setup(p, datetime(2026,10,2,12,tzinfo=timezone.utc)))
    def test_forwarded_setup_rejected(self):
        html=self.post('<span class="tgme_widget_message_forwarded_from">Forwarded</span>\nBuy BTC/USDT<br/>Entry: 100<br/>Stop: 90<br/>Target: 120')
        self.assertIsNone(feed.explicit_setup(feed.parse(html)[0], datetime(2026,9,30,12,tzinfo=timezone.utc)))

if __name__ == '__main__': unittest.main()
