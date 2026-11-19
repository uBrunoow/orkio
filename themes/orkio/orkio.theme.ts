// The orkio theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in orkio.settings.json and the generated orkio.settings.ts;
// change them with `astryx experimental theme editor set orkio ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {orkioSettings} from './orkio.settings';

export const orkioTheme = defineTheme({
  extends: orkioSettings,
  name: 'orkio',
});
