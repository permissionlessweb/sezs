import { ImageOutlined, ImageRounded } from '@mui/icons-material'

import {
  Module,
  ModuleDisplayLocation,
  ModuleId,
  ModuleVisibilityContext,
} from '@dao-dao/types'

import { HeadstashEditors as Editor } from './HeadstashEditors'
import { HeadstashRenderer as Renderer } from './HeadstashRenderer'
import { HeadstashModuleData } from './types'

export const HeadstashModule: Module<HeadstashModuleData> = {
  id: ModuleId.Headstash,
  Icon: ImageOutlined,
  title: 'Headstash',
  description: 'Transparency-minimizing token distribution protocol',
  IconFilled: ImageRounded,
  location: ModuleDisplayLocation.Home,
  visibilityContext: ModuleVisibilityContext.Always,
  defaultValues: {
    fieldNamePrefix: 'headstash.',
    headstashAddr: '',
  },
  Renderer,
  Editor,
}
